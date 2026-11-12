-- ================================================================
-- 043. Закрыть сотрудникам прямой доступ к таблицам сайта мимо приложения.
--
-- Проверка безопасности 12.11.2026. Политики «is_staff()» пускали ЛЮБОГО
-- активного сотрудника — курьера и флориста тоже — прямо в REST-API базы с
-- его токеном входа, мимо экранов и проверки ролей в коде:
--   - менять заказы целиком (RLS строчный, не колоночный: можно было
--     выставить payment_status = 'paid' или поменять сумму);
--   - менять и удалять букеты, разделы каталога, статьи блога;
--   - читать всю базу клиентов, все заказы, всех сотрудников, обращения.
-- Сайт этими правами не пользуется: админка и учёт читают и пишут через
-- сервер служебным ключом после проверки роли (lib/auth/server.ts,
-- lib/actions/*). Поэтому права и политики снимаются без замены.
--
-- Остаётся: посетитель читает опубликованное (букеты, разделы, блог,
-- сторис); вошедший клиент — только свои карточку, заказы и состав.
-- SELECT-гранты не трогаем намеренно (см. 035): без них PostgREST роняет
-- запросы с вложенными таблицами — строки по-прежнему отсекает RLS.
-- ================================================================
begin;

-- Запись — только через сервер
revoke insert, update, delete on public.products, public.product_categories,
  public.blog_posts, public.blog_categories, public.customer_addresses
  from anon, authenticated;
revoke insert, update, delete on public.orders, public.contact_requests from anon, authenticated;

drop policy if exists products_staff_write on public.products;
drop policy if exists product_categories_staff_write on public.product_categories;
drop policy if exists blog_posts_staff_write on public.blog_posts;
drop policy if exists blog_categories_staff_write on public.blog_categories;
drop policy if exists orders_staff_update on public.orders;
drop policy if exists "Сотрудники отмечают обращения обработанными" on public.contact_requests;

-- Чтение «всего» для любого сотрудника — тоже только через сервер
drop policy if exists customers_staff_select_all on public.customers;
drop policy if exists orders_staff_select_all on public.orders;
drop policy if exists order_items_staff_select_all on public.order_items;
drop policy if exists staff_select_all_for_staff on public.staff;
drop policy if exists "Сотрудники читают обращения" on public.contact_requests;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and (qual like '%is_staff()%' or with_check like '%is_staff()%')
      and tablename in ('products', 'product_categories', 'blog_posts', 'blog_categories', 'orders',
                        'order_items', 'customers', 'staff', 'contact_requests')
  ) then
    raise exception 'Остались политики is_staff() на таблицах сайта';
  end if;
  raise notice 'Прямой доступ сотрудников к таблицам сайта закрыт';
end $$;

commit;
