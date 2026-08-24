-- ================================================================
-- Фото собранного букета и просьба об отзыве.
--
-- assembled_photo_url — снимок, который флорист делает после сборки.
-- Клиент видит СВОЙ букет до выезда курьера: главный страх при заказе
-- цветов — «пришлют не то», и один снимок его снимает.
--
-- assembled_photo_sent_at — отметка об отправке. Загрузка и отправка
-- разделены намеренно: снимок можно переснять, а уйдёт клиенту только
-- то, что флорист сознательно отправил. Новая загрузка обнуляет отметку.
--
-- review_requested_at — спрашиваем отзыв один раз, через сутки после
-- доставки. Ставится ДАЖЕ если сообщение не ушло (у клиента нет бота):
-- иначе такой заказ перебирался бы в каждом прогоне планировщика вечно.
-- ================================================================

alter table orders
  add column if not exists assembled_photo_url text,
  add column if not exists assembled_photo_sent_at timestamptz,
  add column if not exists review_requested_at timestamptz;

comment on column orders.assembled_photo_url is
  'Фото собранного букета. Флорист загружает в админке, клиент видит его в боте до доставки.';
comment on column orders.assembled_photo_sent_at is
  'Когда фото ушло клиенту. Защита от повторной отправки того же снимка.';
comment on column orders.review_requested_at is
  'Когда у клиента спросили отзыв. Спрашиваем один раз, не чаще.';

-- Частичный индекс: планировщик каждый день ищет ровно эти строки —
-- доставленные заказы, у которых отзыв ещё не просили.
create index if not exists idx_orders_review_pending
  on orders (status, review_requested_at)
  where review_requested_at is null;
