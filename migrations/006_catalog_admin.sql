-- ================================================================
-- 006 — Ручное редактирование каталога из админки
--
-- availability_mode различает букеты "в наличии" (уже собраны или
-- можно собрать из остатков на складе) и "под заказ" (в основном
-- свадебная флористика — собирается только после оформления заказа
-- и обсуждения с флористом). Раньше такого разделения в схеме не было.
--
-- product-images — бакет для фото букетов, которые добавляет админ
-- вручную (не через синк Posiflora, см. lib/posiflora/catalog.ts) —
-- по аналогии с blog-images из 004_blog_gallery.sql: public: true,
-- публичное чтение без отдельных RLS-политик на storage.objects,
-- запись — только через service-role (lib/actions/catalog.ts).
--
-- Идемпотентно — безопасно выполнять повторно.
-- ================================================================

begin;

alter table products
  add column if not exists availability_mode text not null default 'in_stock';

alter table products
  drop constraint if exists products_availability_mode_check;

alter table products
  add constraint products_availability_mode_check
    check (availability_mode in ('in_stock', 'made_to_order'));

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

commit;
