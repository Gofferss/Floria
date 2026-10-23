-- ================================================================
-- 035. Укрепление защиты по итогам аудита 23.10.2026.
--
-- 1. Телефон из входа на сайте — в том же виде, что везде: +7XXXXXXXXXX.
--    Supabase Auth отдаёт номер без плюса ("79781234567"), и триггер
--    handle_new_customer клал его в карточку как есть. Касса и сайт ищут
--    клиента по "+7…" — не находили и заводили человеку вторую карточку.
--    Заодно в триггере закрыты две ловушки, из-за которых вход по номеру
--    мог не пройти вовсе (ошибка триггера роняет создание пользователя):
--      - две свободные карточки с этим номером ("7978…" и "+7978…") —
--        старый код привязывал ОБЕ и падал на уникальности auth_user_id.
--        Теперь привязываем одну, с правильным видом номера в приоритете;
--      - номер уже занят карточкой, привязанной к другому входу (тот же
--        человек раньше вошёл через VK и указал этот номер). С номером
--        "+7…" вставка упёрлась бы в уникальность телефона — теперь в
--        этом случае заводится карточка без номера, как при входе через VK.
--    Старые карточки с номером без плюса приводим к общему виду — кроме
--    тех, у кого уже есть двойник с плюсом: это один человек в двух
--    карточках, их сливать руками (миграция печатает, сколько таких).
--
-- 2. Права anon и authenticated на таблицы public. Supabase по умолчанию
--    выдаёт им ВСЁ на каждую новую таблицу. Строки закрывает RLS, но:
--      - TRUNCATE в RLS не входит — им таблица стирается целиком;
--      - запись в таблицу без политики держится на одном RLS: выключи
--        его по ошибке — и таблица открыта на запись всему интернету.
--    Сайт пишет в базу только служебным ключом (getSupabaseAdmin), поэтому
--    снимаем: TRUNCATE, REFERENCES, TRIGGER — у обеих ролей на всех
--    таблицах; INSERT, UPDATE, DELETE — там, где нет политики, которая
--    их разрешает этой роли. Политики сотрудников (каталог, блог, заказы)
--    и клиента (свои адреса) продолжают работать как раньше.
--    SELECT не трогаем: без права чтения PostgREST роняет весь запрос с
--    вложенной таблицей, а не отдаёт пустоту, — так сломалась бы витрина.
--    Таблицы будущих миграций по умолчанию получат то же: без TRUNCATE,
--    REFERENCES, TRIGGER, а anon — ещё и без записи.
--
-- 3. Корзина product-images принимала любые файлы любого размера, в том
--    числе SVG — а это документ, в котором может быть скрипт. Теперь в
--    ней только фото и не больше 8 МБ — как и проверяет код
--    (lib/image-upload.ts). В blog-images добавлен HEIC: код его пускает.
-- ================================================================

begin;

-- ---------- 1. Телефон при входе ----------

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
  v_phone text := case
    when v_phone_digits ~ '^[78][0-9]{10}$' then '+7' || right(v_phone_digits, 10)
    when v_phone_digits <> '' then '+' || v_phone_digits
  end;
  v_card uuid;
begin
  if v_phone is not null then
    -- Сравнение по цифрам ловит и старые карточки без плюса. Берём ОДНУ
    -- карточку: при двух подходящих обновление обеих упало бы на
    -- уникальности auth_user_id и не пустило бы человека на сайт.
    select id into v_card
      from customers
     where auth_user_id is null
       and (phone = v_phone or regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone_digits)
     order by (phone = v_phone) desc, created_at
     limit 1;

    if v_card is not null then
      update customers
         set auth_user_id = new.id,
             full_name = coalesce(nullif(customers.full_name, ''), v_full_name)
       where id = v_card;
      return new;
    end if;

    begin
      insert into customers (auth_user_id, full_name, phone)
      values (new.id, v_full_name, v_phone);
      return new;
    exception when unique_violation then
      -- Номер уже у карточки другого входа того же человека. Вход важнее
      -- номера в карточке: заводим её без номера, как при входе через VK.
      null;
    end;
  end if;

  -- Вход без телефона (VK) — или номер занят, см. выше: пустая карточка.
  insert into customers (auth_user_id, full_name)
  values (new.id, v_full_name);

  return new;
end;
$function$;

do $$
declare
  v_twins int;
  v_fixed int;
begin
  update customers c
     set phone = '+7' || right(c.phone, 10)
   where c.phone ~ '^[78][0-9]{10}$'
     and not exists (select 1 from customers d where d.phone = '+7' || right(c.phone, 10));
  get diagnostics v_fixed = row_count;

  select count(*) into v_twins
    from customers c
   where c.phone ~ '^[78][0-9]{10}$';

  raise notice 'телефоны приведены к +7: %, остались двойниками (сливать руками): %', v_fixed, v_twins;
end $$;

-- ---------- 2. Права на таблицы ----------

do $$
declare
  v_table text;
  v_role text;
  v_cmd text;
  v_revoked int := 0;
begin
  for v_table in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', v_table);

    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_cmd in array array['INSERT', 'UPDATE', 'DELETE'] loop
        if not exists (
          select 1
            from pg_policies p
           where p.schemaname = 'public'
             and p.tablename = v_table
             and p.cmd in (v_cmd, 'ALL')
             and (v_role::name = any (p.roles) or 'public'::name = any (p.roles))
        ) and has_table_privilege(v_role, format('public.%I', v_table), v_cmd) then
          execute format('revoke %s on public.%I from %I', v_cmd, v_table, v_role);
          v_revoked := v_revoked + 1;
        end if;
      end loop;
    end loop;
  end loop;

  raise notice 'снято прав на запись без политики: %', v_revoked;
end $$;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke insert, update, delete on tables from anon;
alter default privileges for role supabase_admin in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke insert, update, delete on tables from anon;

-- ---------- 3. Хранилище фото ----------

update storage.buckets
   set file_size_limit = 8 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
 where id = 'product-images';

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
 where id = 'blog-images';

commit;
