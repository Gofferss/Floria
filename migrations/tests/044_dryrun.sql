-- Прогон 044_order_telegram_widget.sql вместе с тестом в одной транзакции, с откатом.
-- Проверяет миграцию на боевой базе до того, как её применить. Сгенерирован scratch-скриптом.
begin;
-- ================================================================
-- 044. Где у клиента живая карточка заказа в Telegram.
--
-- Бот присылает карточку (виджет Bot API 10.4) при оформлении и потом
-- меняет её данные при каждой смене этапа — для этого нужно помнить чат и
-- сообщение. Пусто — карточки нет (клиент не подключил бота, или заказ
-- оформлен до карточек): тогда всё как раньше, обычными сообщениями.
-- Только новые колонки, данные не меняются.
-- ================================================================

alter table public.orders
  add column if not exists customer_widget_chat_id bigint,
  add column if not exists customer_widget_message_id bigint;

comment on column public.orders.customer_widget_chat_id is
  'Telegram: чат клиента, куда прислана живая карточка заказа (lib/telegram/order-widget.ts)';
comment on column public.orders.customer_widget_message_id is
  'Telegram: сообщение с живой карточкой заказа — по нему бот обновляет этап';


-- Проверка миграции 044. Откатывается.

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
