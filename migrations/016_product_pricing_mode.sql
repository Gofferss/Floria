-- ================================================================
-- Поштучная продажа цветов.
--
-- До этого цена товара всегда означала «за собранный букет». Студия
-- продаёт и поштучную срезку, где покупатель сам решает, сколько взять,
-- и там цена означает совсем другое — за одну штуку.
--
-- Отдельная колонка, а не признак в attributes: от неё зависит подача
-- цены на витрине, и запрашивать её приходится в каждой выборке товаров.
-- Значение по умолчанию 'bouquet' — все существующие товары остаются
-- как были, ничего перепроверять не нужно.
-- ================================================================

alter table products
  add column if not exists pricing_mode text not null default 'bouquet';

alter table products
  drop constraint if exists products_pricing_mode_check;

alter table products
  add constraint products_pricing_mode_check
  check (pricing_mode in ('bouquet', 'per_stem'));

comment on column products.pricing_mode is
  'bouquet — цена за готовый букет целиком; per_stem — цена за одну штуку, покупатель выбирает количество.';
