-- ================================================================
-- Маршруты доставки: где адрес на карте, какой курьер везёт и в каком
-- порядке.
--
-- Обычно курьер один, в праздники — два-три (8 марта ~40 доставок). Для
-- этого у доставки появляются координаты, назначенный курьер (его вход,
-- staff с ролью courier) и место в его маршруте. Столбцы одинаковые у
-- заказов сайта (orders) и магазина (pos_orders): доставки планируются
-- вместе, откуда бы ни пришёл заказ.
--
-- Адрес в координаты переводит DaData (lib/geo/dadata.ts). Ответы
-- кэшируются в geo_cache, чтобы один и тот же адрес не спрашивать дважды:
-- бесплатно 10 000 запросов в день, и тратить их на повторы незачем.
-- В DaData уходит только адрес — без имён и телефонов.
-- ================================================================

begin;

create table if not exists geo_cache (
  query         text primary key,
  lat           numeric(9,6),
  lon           numeric(9,6),
  -- Точность по DaData (qc_geo): 0 — дом, 1 — ближайший дом, 2 — улица,
  -- 3 — населённый пункт, 4 — город, 5 — не найден.
  quality       smallint,
  full_address  text,
  fetched_at    timestamptz not null default now()
);

comment on table geo_cache is 'Кэш перевода адресов в координаты (DaData). Только адрес, без персональных данных.';

alter table orders
  add column if not exists delivery_lat      numeric(9,6),
  add column if not exists delivery_lon      numeric(9,6),
  add column if not exists geo_quality       smallint,
  add column if not exists courier_staff_id  uuid references staff(id) on delete set null,
  add column if not exists route_seq         integer;

alter table pos_orders
  add column if not exists delivery_lat      numeric(9,6),
  add column if not exists delivery_lon      numeric(9,6),
  add column if not exists geo_quality       smallint,
  add column if not exists courier_staff_id  uuid references staff(id) on delete set null,
  add column if not exists route_seq         integer;

comment on column orders.courier_staff_id is 'Курьер, который везёт (вход с ролью courier). Пусто — не распределён.';
comment on column orders.route_seq is 'Номер остановки в маршруте курьера на день доставки.';

create index if not exists orders_delivery_plan on orders (delivery_date, courier_staff_id) where not is_pickup;
create index if not exists pos_orders_delivery_plan on pos_orders (delivery_date, courier_staff_id) where not is_pickup;

alter table geo_cache enable row level security;
revoke all on table geo_cache from anon, authenticated;
grant all on table geo_cache to service_role;

commit;
