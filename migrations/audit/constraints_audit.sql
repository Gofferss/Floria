-- ================================================================
-- Проверка ограничений уникальности после переезда базы — ТОЛЬКО ЧТЕНИЕ.
-- Сравнивает то, что задумано миграциями, с тем, что есть в боевой базе.
-- ================================================================

\pset pager off
\pset footer off

\echo '== Повторяющиеся телефоны клиентов (без имён и номеров — только сколько и как записаны)'
select length(phone) as len, left(phone, 2) as starts, count(*) as cards
  from customers
 where phone in (select phone from customers group by 1 having count(*) > 1)
 group by 1, 2;

\echo '== Ограничения и уникальные индексы ключевых таблиц'
select t.relname as table, i.relname as index, ix.indisunique as is_unique, pg_get_indexdef(ix.indexrelid) as def
  from pg_index ix
  join pg_class t on t.oid = ix.indrelid
  join pg_class i on i.oid = ix.indexrelid
  join pg_namespace n on n.oid = t.relnamespace
 where n.nspname = 'public'
   and t.relname in ('customers', 'orders', 'staff', 'promo_codes', 'promo_code_redemptions', 'bot_users', 'products', 'hr_employees', 'pos_sales', 'pos_orders', 'inv_documents')
 order by 1, 2;

\echo '== Внешние ключи, которых нет (пусто — всё на месте): сколько FK у таблиц'
select c.relname as table, count(con.oid) filter (where con.contype = 'f') as fks,
       count(con.oid) filter (where con.contype = 'p') as pks,
       count(con.oid) filter (where con.contype = 'u') as uniques,
       count(con.oid) filter (where con.contype = 'c') as checks
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_constraint con on con.conrelid = c.oid
 where n.nspname = 'public' and c.relkind = 'r'
 group by 1
 order by 1;
