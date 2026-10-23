-- ================================================================
-- Проверка защиты базы — ТОЛЬКО ЧТЕНИЕ. Ничего не меняет.
-- Запуск: тем же путём, что миграции (scratchpad runsql.js), вывод —
-- таблицами psql. Что считается проблемой — в комментарии к каждому блоку.
-- ================================================================

\pset pager off
\pset footer off

\echo '== 1. Таблицы public БЕЗ RLS (должно быть пусто)'
select c.relname as table
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
 order by 1;

\echo '== 2. Права anon / authenticated на таблицы и представления public (каждое — осознанно)'
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
 group by 1, 2
 order by 1, 2;

\echo '== 3. Политики RLS (public и storage)'
select schemaname, tablename, policyname, array_to_string(roles, ',') as roles, cmd,
       left(coalesce(qual, ''), 120) as using_expr, left(coalesce(with_check, ''), 120) as check_expr
  from pg_policies
 where schemaname in ('public', 'storage')
 order by 1, 2, 3;

\echo '== 4. Представления public: security_invoker и доступ anon/authenticated'
select c.relname as view, coalesce(array_to_string(c.reloptions, ','), '') as options,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('v', 'm')
 order by 1;

\echo '== 5. Функции public, которые могут вызвать anon / authenticated'
select p.proname as function, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
 order by 1;

\echo '== 6. SECURITY DEFINER без search_path (риск подмены объектов)'
select p.proname as function, coalesce(array_to_string(p.proconfig, ','), '') as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%')
 order by 1;

\echo '== 7. Хранилище файлов: корзины'
select id, public, file_size_limit, coalesce(array_to_string(allowed_mime_types, ','), 'любые') as mime
  from storage.buckets
 order by 1;

\echo '== 8. Роли с правом входа (лишних быть не должно)'
select rolname, rolsuper, rolbypassrls, rolcreaterole
  from pg_roles
 where rolcanlogin
 order by 1;

\echo '== 9. Расширения'
select extname, extversion from pg_extension order by 1;

\echo '== 10. Учёт: целостность данных'
select 'остатки расходятся с журналом' as check, count(*) as problems from inv_stock_check
union all
select 'мест с двумя открытыми сменами', count(*) from (select location_id from pos_shifts where status = 'open' group by 1 having count(*) > 1) x
union all
select 'бонусы: баланс не равен журналу', count(*) from customers c
  where exists (select 1 from customer_bonus_moves m where m.customer_id = c.id)
    and c.bonus_balance <> (select sum(delta) from customer_bonus_moves m where m.customer_id = c.id)
union all
select 'заказы магазина переплачены', count(*) from pos_orders o where pos_order_paid(o.id) > o.total
union all
select 'проданные букеты без чека', count(*) from pos_bouquets where status = 'sold' and sale_id is null
union all
select 'чеки: оплаты не сходятся с суммой', count(*) from pos_sales s
  where s.status = 'paid' and s.total <> coalesce((select sum(amount) from pos_payments p where p.sale_id = s.id), 0)
union all
select 'клиенты с одинаковым телефоном', count(*) from (select phone from customers group by 1 having count(*) > 1) x
union all
select 'сотрудники Posiflora связаны дважды', count(*) from (select posiflora_worker_id from hr_employees where posiflora_worker_id is not null group by 1 having count(*) > 1) x;

\echo '== 11. Сколько всего'
select (select count(*) from customers) as customers,
       (select count(*) from orders) as site_orders,
       (select count(*) from staff) as staff,
       (select count(*) from auth.users) as auth_users,
       (select count(*) from pos_sales) as till_checks,
       (select count(*) from inv_documents) as stock_docs;
