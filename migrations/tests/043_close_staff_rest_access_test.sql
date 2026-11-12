-- ================================================================
-- Проверка миграции 043. Откатывается.
-- Изображает вход сотрудника (токен с его id) и посетителя без входа.
-- ================================================================
begin;

-- 1. Права записи сняты
do $$
declare
  t text;
begin
  foreach t in array array['products', 'product_categories', 'blog_posts', 'blog_categories', 'customer_addresses', 'orders', 'contact_requests'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception 'У вошедших осталась запись в %', t;
    end if;
  end loop;
  raise notice '1. Записи в таблицы сайта у вошедших нет';
end $$;

-- 2. Нужные политики на месте
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'products' and policyname = 'public_read_active_products') then raise exception 'Пропало чтение каталога'; end if;
  if not exists (select 1 from pg_policies where tablename = 'customers' and policyname = 'customers_select_own') then raise exception 'Клиент не увидит свою карточку'; end if;
  if not exists (select 1 from pg_policies where tablename = 'orders' and policyname = 'orders_customer_select_own') then raise exception 'Клиент не увидит свои заказы'; end if;
  if not exists (select 1 from pg_policies where tablename = 'staff' and policyname = 'staff_select_own') then raise exception 'Сотрудник не прочитает себя'; end if;
  raise notice '2. Чтение своего и каталога осталось';
end $$;

-- 3. Попытка сотрудника напрямую: как курьер с токеном входа
select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', id::text, true)
  from staff where is_active order by created_at limit 1;
set local role authenticated;

do $$
declare
  n int;
begin
  begin
    update public.orders set payment_status = 'paid' where false;
    raise exception 'Сотрудник смог бы менять заказы';
  exception when insufficient_privilege then null; end;
  begin
    update public.products set price = 1 where false;
    raise exception 'Сотрудник смог бы менять цены';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.customers;
  if n > 1 then raise exception 'Сотрудник видит чужих клиентов: %', n; end if;
  select count(*) into n from public.orders o where o.customer_id not in (select id from public.customers);
  if n > 0 then raise exception 'Сотрудник видит чужие заказы: %', n; end if;
  select count(*) into n from public.contact_requests;
  if n > 0 then raise exception 'Сотрудник видит обращения напрямую: %', n; end if;
  raise notice '3. Сотрудник мимо приложения не меняет заказы и цены и не видит чужих клиентов';
end $$;

-- 4. Посетитель без входа по-прежнему видит каталог
reset role;
set local role anon;
do $$
declare
  p int;
  o int;
begin
  select count(*) into p from public.products;
  if p = 0 then raise exception 'Посетитель не видит каталог'; end if;
  select count(*) into o from public.orders;
  if o > 0 then raise exception 'Посетитель видит заказы: %', o; end if;
  raise notice '4. Посетитель видит каталог (% букетов) и не видит заказов', p;
end $$;
reset role;

select 'ВСЕ ПРОВЕРКИ 043 ПРОШЛИ' as result;

rollback;
