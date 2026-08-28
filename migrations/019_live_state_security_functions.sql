-- ================================================================
-- Восстановление в проекте того, что жило только в боевой базе.
--
-- При переезде базы в РФ (август 2026) обнаружилось расхождение:
-- в базе было 4 своих функции и 22 политики доступа, а в файлах
-- миграций — 1 функция и 9 политик. Три функции, включая защиту
-- бонусов от подделки, существовали ТОЛЬКО в живой базе: их
-- применяли напрямую, минуя файлы.
--
-- Чем это грозило: пересоберись база по файлам — при аварии, при
-- восстановлении из копии, при переезде — и дыра с бонусами
-- вернулась бы молча. Сайт работал бы как ни в чём не бывало,
-- пока кто-то не выписал бы себе бесплатные цветы.
--
-- Сам переезд сделан не по файлам, а полным слепком (pg_dump),
-- поэтому в новой базе всё на месте. Этот файл нужен, чтобы
-- расхождение не осталось незаписанным.
-- ================================================================

-- Расширение поиска по тексту. В облаке Supabase оно стояло в public,
-- в своей сборке расширения по умолчанию живут в схеме extensions —
-- индекс по gin_trgm_ops требует именно public.
create extension if not exists pg_trgm with schema public;

-- Кто из вошедших является сотрудником. Отдельная функция нужна,
-- чтобы политики доступа не тянули подзапрос к staff каждый раз.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from staff
    where id = auth.uid() and is_active = true
  );
$function$;

-- Запрет на правку чувствительных колонок кем угодно, кроме сервера.
--
-- Включённой защиты строк здесь было мало: она работает построчно, а
-- не поколоночно. Клиент имел право обновлять СВОЮ строку — и вместе
-- с именем мог переписать себе bonus_balance. Через прямой запрос к
-- базе, в обход сайта, это давало бесплатные букеты.
create or replace function public.protect_customer_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() <> 'service_role' then
    new.bonus_balance := old.bonus_balance;
    new.bonus_balance_synced_at := old.bonus_balance_synced_at;
    new.posiflora_client_id := old.posiflora_client_id;
    new.is_blocked := old.is_blocked;
    new.auth_user_id := old.auth_user_id;
    new.telegram_id := old.telegram_id;
    new.telegram_chat_id := old.telegram_chat_id;
  end if;
  return new;
end;
$function$;

-- Карточка клиента при первом входе.
--
-- Ищем по нормализованному телефону: один и тот же номер приходит то
-- как +7..., то как 8..., и без нормализации в базе плодились дубли
-- карточек на одного человека.
create or replace function public.handle_new_customer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_full_name text := nullif(coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    ''
  ), '');
  v_phone_digits text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
begin
  if v_phone_digits <> '' then
    -- Сравнение по нормализованным цифрам — намеренно не через индекс
    -- на phone (функция в WHERE не даёт им воспользоваться). При
    -- размере таблицы клиентов в сотни-тысячи строк это не проблема;
    -- если вырастет на порядки, разумнее нормализовать phone при
    -- записи (на уровне приложения) и вернуть обычное сравнение.
    update customers
    set auth_user_id = new.id,
        full_name = coalesce(nullif(customers.full_name, ''), v_full_name)
    where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone_digits
      and auth_user_id is null;

    if found then
      return new;
    end if;

    insert into customers (auth_user_id, full_name, phone)
    values (new.id, v_full_name, new.phone);

    return new;
  end if;

  -- Подстраховка на случай не-phone входа в будущем (например, staff
  -- по-прежнему входит через email+пароль и в эту таблицу не попадает
  -- вовсе) — телефона нет, просто пустая карточка.
  insert into customers (auth_user_id, full_name)
  values (new.id, v_full_name);

  return new;
end;
$function$;

-- Триггер висит на auth.users — в служебной схеме, а не в public.
-- Поэтому слепок схемы public его НЕ содержит: при любом переносе
-- его нужно создавать отдельно, иначе регистрация будет проходить
-- «успешно», но карточка клиента не появится, и заметят это нескоро.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_customer();
