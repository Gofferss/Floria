-- ================================================================
-- 007 — Категории и поводы редактируются из админки
--
-- 1) product_categories получает subtitle/image_url — раньше карточки
--    категорий на главной и в фильтре каталога брались из хардкода в
--    lib/mock-data.ts, а не из этой таблицы, хотя products.category_id
--    уже ссылался именно на неё. Существующие 4 категории заполняем
--    теми же текстами/картинками, что были в mock-data.ts — иначе
--    главная страница осиротеет без подписей и фото сразу после миграции.
--
-- 2) occasions — новая таблица, замена хардкоженного OCCASIONS в
--    lib/products.ts. Товары по-прежнему хранят повод как обычную
--    строку в products.attributes.occasions (jsonb-массив) — сверяем
--    по имени, не по отдельному id/slug, поэтому строк товаров трогать
--    не нужно. Сидируем теми же 5 значениями, что были в константе,
--    ON CONFLICT (name) DO NOTHING — чтобы повторный запуск не затирал
--    правки, которые админ уже мог внести через /admin/occasions.
--
-- Идемпотентно — безопасно выполнять повторно.
-- ================================================================

begin;

alter table product_categories
  add column if not exists subtitle text,
  add column if not exists image_url text;

update product_categories set subtitle = 'Свежая срезка, сезонные сборы', image_url = '/category-tulips.jpg'
  where slug = 'tulpany-k-8-marta' and subtitle is null;
update product_categories set subtitle = 'Флористика от студии Floria', image_url = '/category-signature.jpg'
  where slug = 'avtorskie-bukety' and subtitle is null;
update product_categories set subtitle = 'Букет невесты, оформление зала', image_url = '/category-wedding.jpg'
  where slug = 'svadebnaya-floristika' and subtitle is null;
update product_categories set subtitle = 'Свежий букет каждую неделю', image_url = '/category-subscription.jpg'
  where slug = 'cvetochnaya-podpiska' and subtitle is null;

create table if not exists occasions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into occasions (name, sort_order, is_active) values
  ('День рождения', 10, true),
  ('8 марта',        20, true),
  ('Свадьба',        30, true),
  ('Годовщина',      40, true),
  ('Без повода',     50, true)
on conflict (name) do nothing;

alter table occasions enable row level security;

drop policy if exists "public_read_active_occasions" on occasions;
create policy "public_read_active_occasions"
  on occasions for select
  to anon, authenticated
  using (is_active = true);

commit;
