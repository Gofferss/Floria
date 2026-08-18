-- ================================================================
-- 004 — Галерея статей блога + бакет обложек/фото
--
-- 1) gallery_images — доп. фото статьи (для карусели на странице статьи),
--    отдельно от cover_image (обложка в карточке /blog) и от картинок,
--    которые автор вставляет прямо в HTML content через кнопку "Вставить
--    фото в текст" (коллаж текст/фото/текст/фото — им отдельное поле не
--    нужно, они уже часть content).
--
-- 2) storage.buckets — бакет blog-images так и не был создан ни одной
--    из прошлых миграций (только упоминался в комментариях и в
--    next.config.js remotePatterns). Создаём его здесь SQL'ом вместо
--    ручного шага в дашборде — public: true, поэтому публичное чтение
--    работает без отдельных RLS-политик на storage.objects; вся запись
--    всё равно идёт через service-role (lib/actions/blog.ts), который
--    RLS обходит.
--
-- Идемпотентно — безопасно выполнять повторно.
-- ================================================================

begin;

alter table blog_posts
  add column if not exists gallery_images text[] not null default '{}';

insert into storage.buckets (id, name, public)
values ('blog-images', 'blog-images', true)
on conflict (id) do update set public = true;

commit;
