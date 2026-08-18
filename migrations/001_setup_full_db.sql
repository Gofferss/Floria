-- ================================================================
-- FLORIA — полная настройка базы данных (один файл)
-- Объединяет: floria_schema.sql (схема) + RLS-политики +
-- 003_seed_products.sql (наполнение каталога).
--
-- Идемпотентен: безопасно запускать и на пустой базе, и повторно на
-- уже настроенной — ничего не задублируется и не упадёт с ошибкой
-- "already exists". Единственное исключение: CREATE TABLE IF NOT EXISTS
-- не меняет колонки уже существующей таблицы, если её структура
-- почему-то разошлась со скриптом (актуально только если часть схемы
-- была создана вручную раньше).
--
-- Обёрнут в одну транзакцию: если что-то упадёт посередине, в базе
-- не останется частично применённой схемы.
-- ================================================================

begin;

-- ================================================================
-- 0. РАСШИРЕНИЯ
-- ================================================================
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- быстрый нечёткий поиск (ILIKE / похожие названия)


-- ================================================================
-- 0.1 ENUM-ТИПЫ
-- ================================================================
-- У CREATE TYPE нет IF NOT EXISTS, поэтому оборачиваем в DO-блок и
-- глушим ошибку "уже существует" (duplicate_object).

do $$ begin
  create type staff_role as enum ('owner', 'admin', 'manager', 'florist', 'courier');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type order_status as enum (
    'new',          -- создан клиентом / менеджером
    'confirmed',    -- подтверждён (оплата / звонок)
    'assembling',   -- собирается флористом
    'ready',        -- готов к выдаче/отправке
    'delivering',   -- курьер везёт
    'completed',    -- доставлен / выдан
    'cancelled'     -- отменён
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type payment_status as enum (
    'pending',        -- ожидает оплаты
    'paid',           -- оплачен
    'failed',         -- ошибка оплаты
    'refunded',       -- возврат полный
    'partial_refund'  -- возврат частичный
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type payment_method as enum ('tpay', 'sbp', 'cash', 'bonus_only');
exception when duplicate_object then null;
end $$;


-- ================================================================
-- 1. ПОЛЬЗОВАТЕЛИ: сотрудники и клиенты
-- ================================================================

-- ---------- 1.1 Сотрудники / администраторы ----------
create table if not exists staff (
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
create table if not exists customers (
  id                      uuid primary key default gen_random_uuid(),
  auth_user_id            uuid unique references auth.users(id) on delete set null,
  phone                   text not null unique,
  full_name               text,
  email                   text,
  birthday                date,

  posiflora_client_id     text unique,
  bonus_balance           numeric(10,2) not null default 0,
  bonus_balance_synced_at timestamptz,

  notes                   text,
  is_blocked              boolean not null default false,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table customers is 'Клиенты магазина. bonus_balance синхронизируется из Posiflora по расписанию/вебхуку';

-- ---------- 1.3 Сохранённые адреса клиента ----------
create table if not exists customer_addresses (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers(id) on delete cascade,
  title           text,
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

create table if not exists product_categories (
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

create table if not exists products (
  id                      uuid primary key default gen_random_uuid(),
  posiflora_product_id    text not null unique,
  category_id             uuid references product_categories(id) on delete set null,

  name                    text not null,
  slug                    text not null unique,
  description             text,

  price                   numeric(10,2) not null check (price >= 0),
  old_price               numeric(10,2) check (old_price is null or old_price >= price),

  stock_quantity          int not null default 0 check (stock_quantity >= 0),
  is_available            boolean not null default true,

  images                  jsonb not null default '[]'::jsonb,
  attributes              jsonb not null default '{}'::jsonb,

  is_active               boolean not null default true,
  synced_at               timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table products is 'Локальный кэш каталога Posiflora для быстрой отдачи на фронт без прямого похода в кассовую систему';


-- ================================================================
-- 3. ЗАКАЗЫ
-- ================================================================

create table if not exists orders (
  id                        uuid primary key default gen_random_uuid(),
  order_number              text not null unique,
  customer_id               uuid references customers(id) on delete set null,
  posiflora_order_id        text unique,

  customer_name             text not null,
  customer_phone            text not null,
  customer_email            text,

  recipient_name            text not null,
  recipient_phone           text not null,
  is_recipient_self         boolean not null default false,

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
  courier_comment           text,

  card_text                 text,

  items_total                numeric(10,2) not null default 0,
  delivery_price              numeric(10,2) not null default 0,
  discount_total              numeric(10,2) not null default 0,
  bonus_used                  numeric(10,2) not null default 0,
  bonus_earned                 numeric(10,2) not null default 0,
  total_amount                numeric(10,2) not null,

  status                    order_status not null default 'new',
  payment_status             payment_status not null default 'pending',
  payment_method            payment_method,
  payment_provider_id       text,
  paid_at                   timestamptz,

  utm_source                text,
  utm_medium                text,
  utm_campaign               text,
  admin_comment              text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table if not exists order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  product_id     uuid references products(id) on delete set null,

  product_name   text not null,
  unit_price     numeric(10,2) not null check (unit_price >= 0),
  quantity       int not null default 1 check (quantity > 0),
  total_price    numeric(10,2) not null check (total_price >= 0),

  created_at     timestamptz not null default now()
);

create table if not exists order_status_history (
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

create table if not exists blog_categories (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  slug    text not null unique
);

create table if not exists blog_posts (
  id               uuid primary key default gen_random_uuid(),
  author_id        uuid references staff(id) on delete set null,
  category_id      uuid references blog_categories(id) on delete set null,

  title            text not null,
  slug             text not null unique,
  excerpt          text,
  content          text not null,
  cover_image      text,

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

-- У CREATE TRIGGER нет IF NOT EXISTS в PostgreSQL — пересоздаём через
-- DROP IF EXISTS, это работает на любой версии Postgres.

drop trigger if exists trg_staff_updated_at on staff;
create trigger trg_staff_updated_at
  before update on staff for each row execute function set_updated_at();

drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at
  before update on customers for each row execute function set_updated_at();

drop trigger if exists trg_categories_updated_at on product_categories;
create trigger trg_categories_updated_at
  before update on product_categories for each row execute function set_updated_at();

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products for each row execute function set_updated_at();

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at
  before update on orders for each row execute function set_updated_at();

drop trigger if exists trg_blog_posts_updated_at on blog_posts;
create trigger trg_blog_posts_updated_at
  before update on blog_posts for each row execute function set_updated_at();


-- ================================================================
-- 6. ИНДЕКСЫ
-- ================================================================

-- --- customers ---
create index if not exists idx_customers_phone            on customers (phone);
create index if not exists idx_customers_posiflora_id     on customers (posiflora_client_id);
create index if not exists idx_customer_addresses_customer on customer_addresses (customer_id);

-- --- product_categories ---
create index if not exists idx_categories_parent          on product_categories (parent_id);
create index if not exists idx_categories_slug            on product_categories (slug);

-- --- products ---
create index if not exists idx_products_category          on products (category_id);
create index if not exists idx_products_posiflora_id      on products (posiflora_product_id);
create index if not exists idx_products_active            on products (is_active) where is_active = true;
create index if not exists idx_products_name_trgm         on products using gin (name gin_trgm_ops);

-- --- orders ---
create index if not exists idx_orders_customer            on orders (customer_id);
create index if not exists idx_orders_status              on orders (status);
create index if not exists idx_orders_payment_status      on orders (payment_status);
create index if not exists idx_orders_delivery_date       on orders (delivery_date);
create index if not exists idx_orders_created_at          on orders (created_at desc);
create index if not exists idx_orders_customer_phone      on orders (customer_phone);
create index if not exists idx_orders_posiflora_id        on orders (posiflora_order_id);

-- --- order_items / history ---
create index if not exists idx_order_items_order          on order_items (order_id);
create index if not exists idx_order_items_product        on order_items (product_id);
create index if not exists idx_order_status_history_order on order_status_history (order_id);

-- --- blog ---
create index if not exists idx_blog_posts_published
  on blog_posts (published_at desc) where is_published = true;
create index if not exists idx_blog_posts_slug            on blog_posts (slug);
create index if not exists idx_blog_posts_category        on blog_posts (category_id);


-- ================================================================
-- 7. ROW LEVEL SECURITY
-- ================================================================
-- RLS включается на ВСЕХ таблицах. Публичное чтение (SELECT) разрешаем
-- только для контента, который должен быть виден на сайте без
-- авторизации: активные категории/товары и опубликованные статьи блога.
--
-- Остальные таблицы (staff, customers, customer_addresses, orders,
-- order_items, order_status_history) остаются закрытыми для anon и
-- authenticated — без единой SELECT/INSERT политики. Запись и чтение
-- там идёт через service-role ключ (lib/supabase.ts → getSupabaseAdmin(),
-- используется в app/api/orders/route.ts), который RLS обходит.
-- Это осознанный выбор: заказы и данные клиентов не должны быть
-- публично читаемы анонимным ключом даже частично.

alter table staff                enable row level security;
alter table customers            enable row level security;
alter table customer_addresses   enable row level security;
alter table product_categories   enable row level security;
alter table products             enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table order_status_history enable row level security;
alter table blog_categories      enable row level security;
alter table blog_posts           enable row level security;

-- ---------- Публичное чтение каталога ----------
drop policy if exists "public_read_active_categories" on product_categories;
create policy "public_read_active_categories"
  on product_categories for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "public_read_active_products" on products;
create policy "public_read_active_products"
  on products for select
  to anon, authenticated
  using (is_active = true);

-- ---------- Публичное чтение блога ----------
-- lib/blog.ts на фронте пока мок, но политики заводим сразу — задел
-- под перенос блога в Supabase (следующий логичный шаг).
drop policy if exists "public_read_blog_categories" on blog_categories;
create policy "public_read_blog_categories"
  on blog_categories for select
  to anon, authenticated
  using (true);

drop policy if exists "public_read_published_posts" on blog_posts;
create policy "public_read_published_posts"
  on blog_posts for select
  to anon, authenticated
  using (is_published = true);

-- ---------- Опционально: самообслуживание клиента в ЛК ----------
-- Раскомментировать и адаптировать под свою модель авторизации, когда
-- будет готов личный кабинет (/account).

-- create policy "customer_read_own"
--   on customers for select
--   using (auth_user_id = auth.uid());

-- create policy "customer_read_own_orders"
--   on orders for select
--   using (customer_id in (select id from customers where auth_user_id = auth.uid()));


-- ================================================================
-- 8. СИД: КАТЕГОРИИ
-- ================================================================
insert into product_categories (name, slug, sort_order, is_active)
values
  ('Тюльпаны к 8 марта',    'tulpany-k-8-marta',      10, true),
  ('Авторские букеты',      'avtorskie-bukety',       20, true),
  ('Свадебная флористика',  'svadebnaya-floristika',  30, true),
  ('Цветочная подписка',    'cvetochnaya-podpiska',   40, true)
on conflict (slug) do update
set name       = excluded.name,
    sort_order = excluded.sort_order,
    is_active  = excluded.is_active;


-- ================================================================
-- 9. СИД: ТОВАРЫ
-- ================================================================
-- posiflora_product_id заполнен заглушками 'seed:<slug>', т.к. колонка
-- NOT NULL UNIQUE, а реальных ID из кассы пока нет. Найти их потом:
--   select * from products where posiflora_product_id like 'seed:%';
-- Синхронизатор с Posiflora должен матчить товары по slug и
-- перезаписывать posiflora_product_id настоящим значением.
--
-- Размеры/поводы/состав лежат в attributes (jsonb) — отдельных колонок
-- под них в схеме нет.

insert into products (
  posiflora_product_id, category_id, name, slug, description,
  price, old_price, stock_quantity, is_available, is_active, attributes
)
values
  -- ---------- Тюльпаны к 8 марта ----------
  (
    'seed:alye-tyulpany',
    (select id from product_categories where slug = 'tulpany-k-8-marta'),
    'Алые тюльпаны',
    'alye-tyulpany',
    'Классический весенний букет из свежих алых тюльпанов. Собираем утром в день доставки, чтобы бутоны раскрылись у получателя.',
    2400, null, 25, true, true,
    jsonb_build_object(
      'sizes', jsonb_build_array(
        jsonb_build_object('id','s','label','S','priceModifier',0),
        jsonb_build_object('id','m','label','M','priceModifier',900),
        jsonb_build_object('id','l','label','L','priceModifier',1900)
      ),
      'occasions', jsonb_build_array('8 марта','День рождения'),
      'composition', jsonb_build_array(
        'Тюльпан красный — 15 шт','Упаковка — крафт-бумага','Атласная лента'
      )
    )
  ),
  (
    'seed:nezhnyj-vesna',
    (select id from product_categories where slug = 'tulpany-k-8-marta'),
    'Нежная весна',
    'nezhnyj-vesna',
    'Сочетание белых и розовых тюльпанов с веточками эвкалипта — мягкий и воздушный весенний подарок.',
    2900, 3400, 18, true, true,
    jsonb_build_object(
      'sizes', jsonb_build_array(
        jsonb_build_object('id','s','label','S','priceModifier',0),
        jsonb_build_object('id','m','label','M','priceModifier',900),
        jsonb_build_object('id','l','label','L','priceModifier',1900)
      ),
      'occasions', jsonb_build_array('8 марта'),
      'composition', jsonb_build_array(
        'Тюльпан белый — 9 шт','Тюльпан розовый — 6 шт','Эвкалипт','Упаковка — крафт'
      )
    )
  ),

  -- ---------- Авторские букеты ----------
  (
    'seed:avtorskij-miks',
    (select id from product_categories where slug = 'avtorskie-bukety'),
    'Авторский микс «Крым»',
    'avtorskij-miks',
    'Фирменная сборка студии Floria — сочетание фактур и оттенков, которое каждый раз собирается заново из лучшей срезки дня.',
    4200, null, 12, true, true,
    jsonb_build_object(
      'sizes', jsonb_build_array(
        jsonb_build_object('id','s','label','S','priceModifier',0),
        jsonb_build_object('id','m','label','M','priceModifier',900),
        jsonb_build_object('id','l','label','L','priceModifier',1900)
      ),
      'occasions', jsonb_build_array('День рождения','Годовщина','Без повода'),
      'composition', jsonb_build_array(
        'Роза кустовая — 5 шт','Эустома — 3 шт','Маттиола',
        'Зелень по сезону','Упаковка — дизайнерская бумага'
      )
    )
  ),
  (
    'seed:zakat-nad-morem',
    (select id from product_categories where slug = 'avtorskie-bukety'),
    'Закат над морем',
    'zakat-nad-morem',
    'Тёплая палитра терракотовых и персиковых тонов — букет, вдохновлённый крымскими закатами.',
    5100, null, 8, true, true,
    jsonb_build_object(
      'sizes', jsonb_build_array(
        jsonb_build_object('id','s','label','S','priceModifier',0),
        jsonb_build_object('id','m','label','M','priceModifier',900),
        jsonb_build_object('id','l','label','L','priceModifier',1900)
      ),
      'occasions', jsonb_build_array('Годовщина','Без повода'),
      'composition', jsonb_build_array(
        'Роза пионовидная — 7 шт','Ранункулюс — 5 шт','Веточки зелени','Упаковка — крафт'
      )
    )
  ),

  -- ---------- Свадебная флористика ----------
  (
    'seed:buket-nevesty-klassika',
    (select id from product_categories where slug = 'svadebnaya-floristika'),
    'Букет невесты «Классика»',
    'buket-nevesty-klassika',
    'Сдержанный и элегантный букет невесты из белых роз и эустомы. Возможна замена цветов по согласованию с флористом.',
    6800, null, 5, true, true,
    jsonb_build_object(
      'sizes', jsonb_build_array(
        jsonb_build_object('id','m','label','M','priceModifier',0),
        jsonb_build_object('id','l','label','L','priceModifier',1500)
      ),
      'occasions', jsonb_build_array('Свадьба'),
      'composition', jsonb_build_array(
        'Роза белая — 9 шт','Эустома белая','Зелень','Атласная лента','Каркас для букета'
      )
    )
  ),
  (
    'seed:svadebnaya-arka-dekor',
    (select id from product_categories where slug = 'svadebnaya-floristika'),
    'Оформление арки — базовый пакет',
    'svadebnaya-arka-dekor',
    'Базовое цветочное оформление свадебной арки. Финальная смета зависит от площадки и плотности декора — обсуждается с флористом.',
    18500, null, 3, true, true,
    jsonb_build_object(
      'sizes', jsonb_build_array(
        jsonb_build_object('id','std','label','Стандарт','priceModifier',0)
      ),
      'occasions', jsonb_build_array('Свадьба'),
      'composition', jsonb_build_array(
        'Живые цветы по сезону','Зелень','Каркас арки (аренда)','Монтаж и демонтаж'
      )
    )
  ),

  -- ---------- Цветочная подписка ----------
  (
    'seed:podpiska-mini',
    (select id from product_categories where slug = 'cvetochnaya-podpiska'),
    'Подписка «Мини» — букет раз в неделю',
    'podpiska-mini',
    'Свежий небольшой букет каждую неделю в течение месяца — простой способ не забывать о цветах дома.',
    7900, null, 50, true, true,
    jsonb_build_object(
      'sizes', jsonb_build_array(
        jsonb_build_object('id','std','label','На месяц','priceModifier',0)
      ),
      'occasions', jsonb_build_array('Без повода'),
      'composition', jsonb_build_array(
        '4 букета в месяц','Сезонная срезка на выбор флориста','Доставка включена'
      )
    )
  ),
  (
    'seed:podpiska-premium',
    (select id from product_categories where slug = 'cvetochnaya-podpiska'),
    'Подписка «Премиум» — букет раз в неделю',
    'podpiska-premium',
    'Расширенная версия подписки с более крупными и статусными букетами каждую неделю.',
    14900, null, 50, true, true,
    jsonb_build_object(
      'sizes', jsonb_build_array(
        jsonb_build_object('id','std','label','На месяц','priceModifier',0)
      ),
      'occasions', jsonb_build_array('Без повода','Годовщина'),
      'composition', jsonb_build_array(
        '4 крупных букета в месяц','Премиальная срезка','Приоритетная доставка'
      )
    )
  )

on conflict (slug) do update
set category_id    = excluded.category_id,
    name           = excluded.name,
    description    = excluded.description,
    price          = excluded.price,
    old_price      = excluded.old_price,
    stock_quantity = excluded.stock_quantity,
    is_available   = excluded.is_available,
    is_active      = excluded.is_active,
    attributes     = excluded.attributes;

commit;


-- ================================================================
-- ПРОВЕРКА (выполнить отдельно после миграции)
-- ================================================================
-- select c.slug as category, count(p.id) as products
-- from product_categories c
-- left join products p on p.category_id = c.id
-- group by c.slug order by c.slug;
--
-- Ожидается:
--   avtorskie-bukety       | 2
--   cvetochnaya-podpiska   | 2
--   svadebnaya-floristika  | 2
--   tulpany-k-8-marta      | 2
--
-- select tablename, rowsecurity from pg_tables
-- where schemaname = 'public' order by tablename;
-- Ожидается rowsecurity = true для каждой таблицы.
