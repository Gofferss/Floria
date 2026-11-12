-- ================================================================
-- 044. Где у клиента живая карточка заказа в Telegram.
--
-- Бот присылает карточку (виджет Bot API 10.4) при оформлении и потом
-- меняет её данные при каждой смене этапа — для этого нужно помнить чат и
-- сообщение. Пусто — карточки нет (клиент не подключил бота, или заказ
-- оформлен до карточек): тогда всё как раньше, обычными сообщениями.
-- Только новые колонки, данные не меняются.
-- ================================================================
begin;

alter table public.orders
  add column if not exists customer_widget_chat_id bigint,
  add column if not exists customer_widget_message_id bigint;

comment on column public.orders.customer_widget_chat_id is
  'Telegram: чат клиента, куда прислана живая карточка заказа (lib/telegram/order-widget.ts)';
comment on column public.orders.customer_widget_message_id is
  'Telegram: сообщение с живой карточкой заказа — по нему бот обновляет этап';

commit;
