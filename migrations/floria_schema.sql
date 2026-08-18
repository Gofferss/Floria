-- ================================================================
-- FLORIA — интернет-магазин цветов
-- Схема базы данных PostgreSQL / Supabase
-- Интеграции: Posiflora (касса/склад/CRM), Т-Pay, СБП
-- ================================================================
-- Порядок выполнения важен из-за FOREIGN KEY.
-- Скрипт идемпотентен частично (DROP TYPE/DROP TABLE закомментированы,
-- раскомментируйте при пересоздании схемы с нуля).
-- ================================================================


-- ================================================================
-- 0. РАСШИРЕНИЯ
-- ================================================================
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- быстрый нечёткий поиск (ILIKE / похожие названия)


-- ================================================================
-- 0.1 ENUM-ТИПЫ
-- ================================================================
create type staff_role as enum ('owner', 'admin', 'manager', 'florist', 'courier');

create type order_status as enum (
  'new',          -- создан клиентом / менеджером
  'confirmed',    -- подтверждён (оплата / звонок)
  'assembling',   -- собирается флористом
  'ready',        -- готов к выдаче/отправке
  'delivering',   -- курьер везёт
  'completed',    -- доставлен / выдан
  'cancelled'     -- отменён
);

create type payment_status as enum (
  'pending',        -- ожидает оплаты
  'paid',           -- оплачен
  'failed',         -- ошибка оплаты
  'refunded',       -- возврат полный
  'partial_refund'  -- возврат частичный
);

create type payment_method as enum ('tpay', 'sbp', 'cash', 'bonus_only');


-- ================================================================
-- 1. ПОЛЬЗОВАТЕЛИ: сотрудники и клиенты
-- ================================================================

-- ---------- 1.1 Сотрудники / администраторы ----------
-- Авторизация через Supabase Auth (auth.users), эта таблица — профиль с ролью.
create table staff (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          staff_role not null default 'manager',
  full_name     text not null,
  phone         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table staff is 'Сотрудники и администраторы: флористы, курьеры, менеджеры, владелец';

-- ---------- 1.2 Клиенты ----------
create table customers (
  id                      uuid primary key default gen_random_uuid(),
  auth_user_id            uuid unique references auth.users(id) on delete set null, -- заполняется, если клиент зарегистрировался в ЛК
  phone                   text not null unique,   -- основной идентификатор (гостевые заказы тоже по телефону)
  full_name               text,
  email                   text,
  birthday                date,

  -- --- интеграция с Posiflora ---
  posiflora_client_id     text unique,             -- id клиента в Posiflora
  bonus_balance           numeric(10,2) not null default 0,
  bonus_balance_synced_at timestamptz,             -- когда последний раз подтянут баланс

  notes                   text,                    -- служебные заметки менеджера
  is_blocked              boolean not null default false,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table customers is 'Клиенты магазина. bonus_balance синхронизируется из Posiflora по расписанию/вебхуку';

-- ---------- 1.3 Сохранённые адреса клиента (для ЛК, повторные заказы) ----------
create table customer_addresses (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers(id) on delete cascade,
  title           text,                          -- 'Дом', 'Офис', ...
  city            text not null default 'Симферополь',
  address_line    text not null,
  entrance        text,
  floor           text,
  apartment       text,
  intercom_code   text,
  comment         text,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now()
);


-- ================================================================
-- 2. КЭШ КАТАЛОГА ТОВАРОВ (синхронизация с Posiflora)
-- ================================================================

create table product_categories (
  id                      uuid primary key default gen_random_uuid(),
  posiflora_category_id   text unique,
  name                    text not null,
  slug                    text not null unique,
  parent_id               uuid references product_categories(id) on delete set null,
  sort_order              int not null default 0,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table products (
  id                      uuid primary key default gen_random_uuid(),
  posiflora_product_id    text not null unique,     -- ключ синхронизации с Posiflora
  category_id             uuid references product_categories(id) on delete set null,

  name                    text not null,
  slug                    text not null unique,
  description             text,

  price                   numeric(10,2) not null check (price >= 0),
  old_price               numeric(10,2) check (old_price is null or old_price >= price),

  stock_quantity          int not null default 0 check (stock_quantity >= 0),
  is_available            boolean not null default true,  -- ручной оверрайд ("скрыть, хотя есть на складе")

  images                  jsonb not null default '[]'::jsonb,   -- ["https://.../1.jpg", ...]
  attributes              jsonb not null default '{}'::jsonb,   -- {"height_cm":60,"composition":"розы, эустома"}

  is_active               boolean not null default true,  -- показывать ли товар на сайте вообще
  synced_at               timestamptz,                      -- время последней синхронизации

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table products is 'Локальный кэш каталога Posiflora для быстрой отдачи на фронт без прямого похода в кассовую систему';


-- ================================================================
-- 3. ЗАКАЗЫ
-- ================================================================

create table orders (
  id                        uuid primary key default gen_random_uuid(),
  order_number              text not null unique,        -- человекочитаемый номер, напр. 'FL-10234'
  customer_id               uuid references customers(id) on delete set null,
  posiflora_order_id        text unique,                  -- id после выгрузки заказа в Posiflora

  -- --- данные заказчика (может отличаться от клиента, если оформляет "за кого-то") ---
  customer_name             text not null,
  customer_phone            text not null,
  customer_email            text,

  -- --- данные получателя ---
  recipient_name            text not null,
  recipient_phone           text not null,
  is_recipient_self         boolean not null default false,

  -- --- доставка / самовывоз ---
  is_pickup                 boolean not null default false,
  delivery_city             text not null default 'Симферополь',
  delivery_address          text,
  delivery_entrance         text,
  delivery_floor            text,
  delivery_apartment        text,
  delivery_intercom_code    text,
  delivery_date             date not null,
  delivery_time_from        time,
  delivery_time_to          time,
  courier_comment           text,                          -- комментарий для курьера

  -- --- открытка ---
  card_text                 text,                          -- текст записки к букету

  -- --- суммы ---
  items_total                numeric(10,2) not null default 0,
  delivery_price              numeric(10,2) not null default 0,
  discount_total              numeric(10,2) not null default 0,
  bonus_used                  numeric(10,2) not null default 0,
  bonus_earned                 numeric(10,2) not null default 0,
  total_amount                numeric(10,2) not null,

  -- --- статусы и оплата ---
  status                    order_status not null default 'new',
  payment_status             payment_status not null default 'pending',
  payment_method            payment_method,
  payment_provider_id       text,                          -- id транзакции Т-Pay / СБП
  paid_at                   timestamptz,

  -- --- маркетинг / служебное ---
  utm_source                text,
  utm_medium                text,
  utm_campaign               text,
  admin_comment              text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Состав заказа. Данные товара ДУБЛИРУЮТСЯ (снимок на момент покупки),
-- чтобы изменение цены/названия в каталоге не искажало историю заказов.
create table order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  product_id     uuid references products(id) on delete set null,

  product_name   text not null,
  unit_price     numeric(10,2) not null check (unit_price >= 0),
  quantity       int not null default 1 check (quantity > 0),
  total_price    numeric(10,2) not null check (total_price >= 0),

  created_at     timestamptz not null default now()
);

-- История смены статусов — полезно для саппорта и аналитики SLA доставки
create table order_status_history (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  status       order_status not null,
  changed_by   uuid references staff(id) on delete set null,
  comment      text,
  created_at   timestamptz not null default now()
);


-- ================================================================
-- 4. НОВОСТИ / БЛОГ (SEO-контент)
-- ================================================================

create table blog_categories (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  slug    text not null unique
);

create table blog_posts (
  id               uuid primary key default gen_random_uuid(),
  author_id        uuid references staff(id) on delete set null,
  category_id      uuid references blog_categories(id) on delete set null,

  title            text not null,
  slug             text not null unique,
  excerpt          text,               -- краткое описание для карточки в ленте
  content          text not null,      -- HTML/Markdown тела статьи
  cover_image      text,

  -- --- SEO ---
  seo_title        text,
  seo_description  text,
  seo_keywords     text,

  is_published     boolean not null default false,
  published_at     timestamptz,
  views_count      int not null default 0,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);


-- ================================================================
-- 5. ТРИГГЕРЫ: автообновление updated_at
-- ================================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_staff_updated_at
  before update on staff for each row execute function set_updated_at();
create trigger trg_customers_updated_at
  before update on customers for each row execute function set_updated_at();
create trigger trg_categories_updated_at
  before update on product_categories for each row execute function set_updated_at();
create trigger trg_products_updated_at
  before update on products for each row execute function set_updated_at();
create trigger trg_orders_updated_at
  before update on orders for each row execute function set_updated_at();
create trigger trg_blog_posts_updated_at
  before update on blog_posts for each row execute function set_updated_at();


-- ================================================================
-- 6. ИНДЕКСЫ
-- ================================================================

-- --- customers ---
create index idx_customers_phone            on customers (phone);
create index idx_customers_posiflora_id     on customers (posiflora_client_id);
create index idx_customer_addresses_customer on customer_addresses (customer_id);

-- --- product_categories ---
create index idx_categories_parent          on product_categories (parent_id);
create index idx_categories_slug            on product_categories (slug);

-- --- products ---
create index idx_products_category          on products (category_id);
create index idx_products_posiflora_id      on products (posiflora_product_id);
create index idx_products_active            on products (is_active) where is_active = true;
create index idx_products_name_trgm         on products using gin (name gin_trgm_ops); -- нечёткий поиск по названию

-- --- orders ---
create index idx_orders_customer            on orders (customer_id);
create index idx_orders_status              on orders (status);
create index idx_orders_payment_status      on orders (payment_status);
create index idx_orders_delivery_date       on orders (delivery_date);
create index idx_orders_created_at          on orders (created_at desc);
create index idx_orders_customer_phone      on orders (customer_phone);
create index idx_orders_posiflora_id        on orders (posiflora_order_id);

-- --- order_items / history ---
create index idx_order_items_order          on order_items (order_id);
create index idx_order_items_product        on order_items (product_id);
create index idx_order_status_history_order on order_status_history (order_id);

-- --- blog ---
create index idx_blog_posts_published
  on blog_posts (published_at desc) where is_published = true;
create index idx_blog_posts_slug            on blog_posts (slug);
create index idx_blog_posts_category        on blog_posts (category_id);


-- ================================================================
-- 7. (ОПЦИОНАЛЬНО) ROW LEVEL SECURITY — включить перед проды в Supabase
-- ================================================================
-- Ниже — минимальный каркас. Раскомментируйте и адаптируйте под свою
-- модель авторизации (роль в JWT, auth.uid() и т.д.) перед продакшеном.

-- alter table customers enable row level security;
-- create policy "customer_read_own"
--   on customers for select
--   using (auth_user_id = auth.uid());

-- alter table orders enable row level security;
-- create policy "customer_read_own_orders"
--   on orders for select
--   using (customer_id in (select id from customers where auth_user_id = auth.uid()));

-- alter table products enable row level security;
-- create policy "public_read_active_products"
--   on products for select
--   using (is_active = true);

-- alter table blog_posts enable row level security;
-- create policy "public_read_published_posts"
--   on blog_posts for select
--   using (is_published = true);

-- Для staff-таблиц и записи в orders/customers обычно используют
-- service_role ключ (бэкенд), минуя RLS — тогда политики нужны в основном
-- на SELECT для клиентского ЛК.
