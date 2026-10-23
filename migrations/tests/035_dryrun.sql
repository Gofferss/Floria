-- Прогон 035_security_hardening.sql вместе с тестом в одной транзакции, с откатом.
-- Проверяет миграцию на боевой базе до того, как её применить. Сгенерирован scratch-скриптом.
begin;
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


-- ================================================================
-- Проверка миграции 035 (телефон при входе, права, хранилище). Откатывается.
-- ================================================================



do $$
declare
  u1 uuid := 'e0000000-0000-4000-8000-000000003501';
  u2 uuid := 'e0000000-0000-4000-8000-000000003502';
  u3a uuid := 'e0000000-0000-4000-8000-000000003503';
  u3b uuid := 'e0000000-0000-4000-8000-000000003513';
  u4 uuid := 'e0000000-0000-4000-8000-000000003504';
  u5 uuid := 'e0000000-0000-4000-8000-000000003505';
  card uuid;
  card_old uuid;
  n int;
  v_phone text;
begin
  -- 1. Новый вход по номеру без плюса — в карточке номер с плюсом.
  insert into auth.users (id, instance_id, aud, role, phone, created_at, updated_at)
  values (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '79990003501', now(), now());
  select phone into v_phone from customers where auth_user_id = u1;
  if v_phone is distinct from '+79990003501' then raise exception 'ТЕСТ 1: в карточке номер % вместо +79990003501', v_phone; end if;
  raise notice 'OK 1: вход по номеру записывает его как +7…';

  -- 2. Карточка из кассы (+7…) находится и привязывается, второй не появляется.
  insert into customers (phone, full_name) values ('+79990003502', 'ТЕСТ Касса') returning id into card;
  insert into auth.users (id, instance_id, aud, role, phone, created_at, updated_at)
  values (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '79990003502', now(), now());
  if (select auth_user_id from customers where id = card) is distinct from u2 then raise exception 'ТЕСТ 2: карточка кассы не привязалась'; end if;
  select count(*) into n from customers where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = '79990003502';
  if n <> 1 then raise exception 'ТЕСТ 2: карточек с этим номером % вместо 1', n; end if;
  raise notice 'OK 2: карточка из кассы привязывается ко входу, дубля нет';

  -- 3. Номер занят карточкой другого входа — вход всё равно проходит.
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (u3a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test3503@floria.invalid', now(), now());
  update customers set phone = '+79990003503' where auth_user_id = u3a;
  insert into auth.users (id, instance_id, aud, role, phone, created_at, updated_at)
  values (u3b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '79990003503', now(), now());
  if not exists (select 1 from customers where auth_user_id = u3b and phone is null) then
    raise exception 'ТЕСТ 3: у второго входа нет карточки без номера';
  end if;
  if (select phone from customers where auth_user_id = u3a) is distinct from '+79990003503' then raise exception 'ТЕСТ 3: у первого входа отняли номер'; end if;
  raise notice 'OK 3: занятый номер не роняет вход';

  -- 4. Две свободные карточки одного номера — привязывается одна, с плюсом.
  insert into customers (phone, full_name) values ('79990003504', 'ТЕСТ Старая') returning id into card_old;
  insert into customers (phone, full_name) values ('+79990003504', 'ТЕСТ Новая') returning id into card;
  insert into auth.users (id, instance_id, aud, role, phone, created_at, updated_at)
  values (u4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '79990003504', now(), now());
  if (select auth_user_id from customers where id = card) is distinct from u4 then raise exception 'ТЕСТ 4: не привязалась карточка с плюсом'; end if;
  if (select auth_user_id from customers where id = card_old) is not null then raise exception 'ТЕСТ 4: привязалась и старая карточка'; end if;
  raise notice 'OK 4: из двух карточек привязывается одна';

  -- 5. Вход без телефона (VK) — пустая карточка, как раньше.
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (u5, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test3505@floria.invalid', '{"name": "ТЕСТ ВК"}', now(), now());
  if not exists (select 1 from customers where auth_user_id = u5 and phone is null and full_name = 'ТЕСТ ВК') then
    raise exception 'ТЕСТ 5: нет пустой карточки для входа без телефона';
  end if;
  raise notice 'OK 5: вход без телефона заводит карточку без номера';

  -- 6. Права: TRUNCATE ни у кого, запись без политики снята, с политикой — осталась.
  if has_table_privilege('anon', 'public.orders', 'TRUNCATE') or has_table_privilege('authenticated', 'public.products', 'TRUNCATE') then
    raise exception 'ТЕСТ 6: TRUNCATE остался';
  end if;
  if has_table_privilege('anon', 'public.orders', 'INSERT') or has_table_privilege('anon', 'public.products', 'UPDATE')
     or has_table_privilege('anon', 'public.staff', 'DELETE') or has_table_privilege('authenticated', 'public.staff', 'UPDATE')
     or has_table_privilege('authenticated', 'public.orders', 'INSERT') or has_table_privilege('authenticated', 'public.promo_codes', 'INSERT') then
    raise exception 'ТЕСТ 6: осталась запись без политики';
  end if;
  if not (has_table_privilege('authenticated', 'public.products', 'INSERT') and has_table_privilege('authenticated', 'public.orders', 'UPDATE')
          and has_table_privilege('authenticated', 'public.customer_addresses', 'DELETE') and has_table_privilege('authenticated', 'public.contact_requests', 'UPDATE')
          and has_table_privilege('authenticated', 'public.blog_posts', 'UPDATE')) then
    raise exception 'ТЕСТ 6: сняли запись, которую разрешает политика';
  end if;
  if not (has_table_privilege('anon', 'public.products', 'SELECT') and has_table_privilege('anon', 'public.stories', 'SELECT')) then
    raise exception 'ТЕСТ 6: витрина потеряла чтение';
  end if;
  raise notice 'OK 6: права сняты ровно там, где нет политики';

  -- 7. Новая таблица получает урезанные права по умолчанию.
  create table public.zz_035_probe (id int);
  if has_table_privilege('anon', 'public.zz_035_probe', 'INSERT') or has_table_privilege('anon', 'public.zz_035_probe', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.zz_035_probe', 'TRUNCATE') then
    raise exception 'ТЕСТ 7: новая таблица снова открыта на запись или TRUNCATE';
  end if;
  raise notice 'OK 7: новые таблицы — без записи для anon и без TRUNCATE';

  -- 8. Хранилище: только фото, не больше 8 МБ.
  if not exists (select 1 from storage.buckets where id = 'product-images' and file_size_limit = 8388608
                 and 'image/jpeg' = any (allowed_mime_types) and not ('image/svg+xml' = any (allowed_mime_types))) then
    raise exception 'ТЕСТ 8: product-images принимает лишнее';
  end if;
  raise notice 'OK 8: product-images принимает только фото до 8 МБ';

  raise notice '035: все 8 проверок прошли';
end $$;


rollback;
