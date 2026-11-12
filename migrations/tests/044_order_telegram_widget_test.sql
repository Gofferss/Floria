-- Проверка миграции 044. Откатывается.
begin;

do $$
begin
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'customer_widget_chat_id') <> 'bigint'
     or (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'customer_widget_message_id') <> 'bigint' then
    raise exception 'Колонок карточки нет или не тот тип';
  end if;
  if has_column_privilege('authenticated', 'public.orders', 'customer_widget_message_id', 'UPDATE')
     or has_column_privilege('anon', 'public.orders', 'customer_widget_message_id', 'UPDATE') then
    raise exception 'Колонку карточки можно менять снаружи';
  end if;
  raise notice 'Колонки карточки есть, снаружи не меняются';
end $$;

select 'ВСЕ ПРОВЕРКИ 044 ПРОШЛИ' as result;

rollback;
