-- ================================================================
-- Что видит сотрудник, если пойдёт в базу напрямую со своим токеном — ТОЛЬКО ЧТЕНИЕ.
-- Изображает вход первого активного сотрудника и считает строки, без
-- содержимого. После миграции 043 должно быть 0 везде, кроме каталога.
-- ================================================================
\pset pager off
\pset footer off
begin;
select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true) is not null as token_set,
       set_config('request.jwt.claim.sub', id::text, true) is not null as sub_set
  from staff where is_active order by created_at limit 1;
set local role authenticated;
\echo '== Видно сотруднику напрямую (строк)'
select (select count(*) from public.customers) as customers,
       (select count(*) from public.orders) as orders,
       (select count(*) from public.contact_requests) as contact_requests,
       (select count(*) from public.staff) as staff,
       (select count(*) from public.products) as products;
\echo '== Права на запись'
select has_table_privilege('authenticated', 'public.orders', 'UPDATE') as orders_update,
       has_table_privilege('authenticated', 'public.products', 'UPDATE') as products_update;
rollback;
