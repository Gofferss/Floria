-- ⚠️ ПОГЛОЩЕНО migrations/001_setup_full_db.sql — для новой/пустой базы
-- запускайте только 001, этот файл не нужен (именно попытка запустить
-- этот файл в одиночку на пустой базе и вызвала ошибку
-- "relation product_categories does not exist", из-за которой появился 001).
-- Оставлен для истории и для тех, у кого таблицы уже созданы и нужно
-- только досеять/обновить каталог.
-- ================================================================
-- Миграция 003: наполнение каталога (seed)
-- Переносит категории и товары из lib/products.ts / lib/mock-data.ts
-- в таблицы product_categories и products.
-- ================================================================
--
-- ВАЖНО ПРО ИМЕНА ТАБЛИЦ:
-- В схеме (floria_schema.sql) таблица категорий называется
-- `product_categories`, а не `categories`.
--
-- ВАЖНО ПРО posiflora_product_id:
-- Колонка объявлена NOT NULL UNIQUE, а реальных ID из кассы у нас пока нет.
-- Для сид-данных используем префикс 'seed:' — так их легко найти и заменить,
-- когда заработает реальная синхронизация:
--     select * from products where posiflora_product_id like 'seed:%';
-- Синхронизатор должен матчить товары по slug и перезаписывать
-- posiflora_product_id настоящим значением.
--
-- ВАЖНО ПРО РАЗМЕРЫ И ПОВОДЫ:
-- Отдельных колонок под них в схеме нет, поэтому они уезжают в `attributes`
-- (jsonb) в формате:
--   {
--     "sizes":     [{"id":"s","label":"S","priceModifier":0}, ...],
--     "occasions": ["8 марта", "День рождения"],
--     "composition": ["Тюльпан красный — 15 шт", ...]
--   }
--
-- Скрипт ИДЕМПОТЕНТЕН: повторный запуск обновит существующие строки
-- (ON CONFLICT ... DO UPDATE), а не создаст дубли.
-- ================================================================


begin;

-- ================================================================
-- 1. КАТЕГОРИИ
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
-- 2. ТОВАРЫ
-- ================================================================
-- category_id подставляется подзапросом по slug категории, чтобы не
-- зашивать в скрипт сгенерированные UUID.

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


-- ================================================================
-- 3. RLS: публичное чтение каталога
-- ================================================================
-- Фронтенд читает каталог анонимным ключом (lib/supabase.ts → supabase).
-- Без включённого RLS анонимный ключ может не только читать, но и ПИСАТЬ
-- в эти таблицы — поэтому включаем RLS и разрешаем только SELECT
-- активных записей. Запись остаётся за service-role ключом (он RLS обходит).

alter table product_categories enable row level security;
alter table products           enable row level security;

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
