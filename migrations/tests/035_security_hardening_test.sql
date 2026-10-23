-- ================================================================
-- Проверка миграции 035 (телефон при входе, права, хранилище). Откатывается.
-- ================================================================

\set ON_ERROR_STOP on

begin;

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
