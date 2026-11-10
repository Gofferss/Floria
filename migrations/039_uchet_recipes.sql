-- ================================================================
-- 039. Рецепты букетов, отложенные чеки, маленькое название букета на сайте.
--
-- Рецепт — это букет, который собирают снова и снова: состав, фото и цена.
-- Цена по составу считается от цен цветов на складе, поэтому меняется
-- вместе с ними; можно поставить и свою. Из рецепта флорист продаёт букет
-- или собирает его на витрину в одно касание. Рецепт может быть связан с
-- букетом на сайте: тогда название, цену и состав на сайте обновляют из
-- рецепта, а не руками в двух местах.
--
-- Отложенный чек раньше жил только на айпаде, где его отложили: второй
-- айпад и владелец не видели, что цветы уже кому-то обещаны. Теперь он
-- записывается сюда, и касса показывает на плитке, сколько отложено.
-- Это черновик, а не учётный документ: остаток он не меняет, после
-- оплаты или возврата в чек строка удаляется, а забытая через сутки
-- перестаёт учитываться.
--
-- nickname у товара сайта — короткое название букета («Солнышко»),
-- которое показывается мелко рядом с основным «Букет из …».
-- ================================================================

begin;

-- ---------------------------------------------------------------
-- Маленькое название букета на сайте
-- ---------------------------------------------------------------

alter table products add column if not exists nickname text;
alter table products drop constraint if exists products_nickname_len;
alter table products add constraint products_nickname_len
  check (nickname is null or char_length(btrim(nickname)) between 1 and 60);

comment on column products.nickname is
  'Короткое название букета, показывается мелко рядом с основным: «Солнышко». NULL — нет.';

-- ---------------------------------------------------------------
-- Рецепты
-- ---------------------------------------------------------------

create table if not exists pos_recipes (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(btrim(title)) between 1 and 160),
  nickname           text check (nickname is null or char_length(btrim(nickname)) between 1 and 60),
  photo_url          text,
  price_mode         text not null default 'composition' check (price_mode in ('composition', 'fixed')),
  fixed_price        numeric(12,2) check (fixed_price is null or fixed_price >= 0),
  -- Букет на сайте, который описывает этот рецепт.
  product_id         uuid references products(id) on delete set null,
  -- Откуда пришёл: спецификация Posiflora. Повторный импорт её не задвоит.
  posiflora_spec_id  text unique,
  -- Цена в Posiflora на момент импорта — для сверки, не для продажи.
  posiflora_price    numeric(12,2),
  is_active          boolean not null default true,
  sort               integer not null default 0,
  created_by         uuid references staff(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint pos_recipes_fixed_has_price check (price_mode <> 'fixed' or fixed_price is not null)
);

comment on table pos_recipes is 'Рецепты букетов: состав, фото, цена по составу или своя. Состав — pos_recipe_items.';

create index if not exists pos_recipes_active on pos_recipes (is_active, sort, title);
create index if not exists pos_recipes_product on pos_recipes (product_id);

create table if not exists pos_recipe_items (
  recipe_id  uuid not null references pos_recipes(id) on delete cascade,
  item_id    uuid not null references inv_items(id),
  qty        numeric(12,3) not null check (qty > 0),
  sort       integer not null default 0,
  primary key (recipe_id, item_id)
);

drop trigger if exists pos_recipes_updated on pos_recipes;
create trigger pos_recipes_updated before update on pos_recipes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- Отложенные чеки
-- ---------------------------------------------------------------

create table if not exists pos_held_checks (
  -- Тот же id, под которым чек потом станет продажей.
  id           uuid primary key,
  location_id  uuid not null references inv_locations(id),
  title        text not null,
  total        numeric(12,2) not null default 0 check (total >= 0),
  -- Что отложено: [{"item_id": "…", "qty": 3}] — цветы букетов и позиции чека.
  items        jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  employee_id  uuid references hr_employees(id) on delete set null,
  staff_id     uuid references staff(id) on delete set null,
  device_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table pos_held_checks is 'Отложенные чеки кассы: что обещано покупателю, но ещё не оплачено. Черновик, остаток не меняет.';

create index if not exists pos_held_checks_location on pos_held_checks (location_id, updated_at);

drop trigger if exists pos_held_checks_updated on pos_held_checks;
create trigger pos_held_checks_updated before update on pos_held_checks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- Доступ: как у остальных таблиц кассы — только сервер.
-- ---------------------------------------------------------------

alter table pos_recipes      enable row level security;
alter table pos_recipe_items enable row level security;
alter table pos_held_checks  enable row level security;

revoke all on table pos_recipes, pos_recipe_items, pos_held_checks from anon, authenticated;
grant all on table pos_recipes, pos_recipe_items, pos_held_checks to service_role;

commit;
