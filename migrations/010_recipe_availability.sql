-- ================================================================
-- Автоматическое "в наличии/под заказ" по составу букета.
--
-- availability_source различает, кто управляет availability_mode
-- товара: 'manual' (как раньше — куратор переключает вручную,
-- дефолт для всех существующих товаров) или 'recipe' (пересчитывается
-- синком по остаткам ингредиентов на складе Posiflora, см.
-- lib/posiflora/catalog.ts, syncComputedAvailability). Ручной режим
-- всегда доступен как явный откат — переключить товар обратно на
-- 'manual' можно в любой момент из формы товара.
--
-- product_recipe_items — рецепт: какая позиция склада Posiflora и в
-- каком количестве нужна для одного букета. Живёт только у нас
-- (в Posiflore рецепты/спецификации сейчас не используются, см.
-- обсуждение) — item_name кэшируем на момент сохранения, чтобы
-- показывать список в админке без лишнего похода в Posiflora.
-- ================================================================

alter table products
  add column if not exists availability_source text not null default 'manual';

alter table products
  drop constraint if exists products_availability_source_check;
alter table products
  add constraint products_availability_source_check
    check (availability_source in ('manual', 'recipe'));

create table if not exists product_recipe_items (
  id                            uuid primary key default gen_random_uuid(),
  product_id                    uuid not null references products(id) on delete cascade,
  posiflora_inventory_item_id   text not null,
  item_name                     text not null,
  quantity                      numeric(10,2) not null check (quantity > 0),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists idx_product_recipe_items_product_id on product_recipe_items (product_id);

alter table product_recipe_items enable row level security;
-- Deny-by-default, без единой политики — доступ только через
-- service-role (та же схема, что у остальных приватных таблиц проекта:
-- политики нет, значит anon/authenticated не видят ничего).

drop trigger if exists trg_product_recipe_items_updated_at on product_recipe_items;
create trigger trg_product_recipe_items_updated_at
  before update on product_recipe_items for each row execute function set_updated_at();
