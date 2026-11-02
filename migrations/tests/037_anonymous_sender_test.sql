-- ================================================================
-- Проверка миграции 037 (анонимный букет). Откатывается.
-- ================================================================

\set ON_ERROR_STOP on

begin;

do $$
begin
  -- 1. Признак есть, по умолчанию выключен — старые заказы не стали анонимными.
  if exists (select 1 from orders where is_anonymous) then
    raise exception 'ТЕСТ 1: после миграции есть анонимные заказы';
  end if;
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'orders' and column_name = 'is_anonymous') <> 'false' then
    raise exception 'ТЕСТ 1: умолчание не false';
  end if;
  raise notice 'OK 1: признак есть, у прежних заказов выключен';

  -- 2. Аноним не пишет в заказы и после новой колонки (миграция 035).
  if has_table_privilege('anon', 'public.orders', 'INSERT') or has_table_privilege('anon', 'public.orders', 'UPDATE') then
    raise exception 'ТЕСТ 2: у anon появилась запись в orders';
  end if;
  raise notice 'OK 2: запись в заказы анониму по-прежнему закрыта';

  raise notice '037: все 2 проверки прошли';
end $$;

rollback;
