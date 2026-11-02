-- ================================================================
-- 036. Видео в сторис.
--
-- Слайд истории теперь — фото или видео (media_type). Адрес ролика лежит
-- в той же колонке image_url: переименовывать её ради одного нового вида
-- значило бы трогать весь код сторис и старые записи.
-- У видео обязательна обложка (poster_url) — кадр, который виден в кружке
-- на главной, пока ролик грузится, и вместо ролика, если браузер его не
-- сможет показать. Без неё кружок истории с видео первым слайдом был бы
-- пустым.
--
-- Ролики — в своей корзине story-videos: у product-images предел 8 МБ и
-- только фото (миграция 035). Сюда браузер грузит исходник с телефона
-- напрямую (до 200 МБ, папка incoming/), сервер пережимает его в MP4 720p
-- (lib/video/story-video.ts), кладёт в stories/ и исходник удаляет.
-- ================================================================

begin;

alter table story_items add column if not exists media_type text not null default 'image';
alter table story_items drop constraint if exists story_items_media_type_check;
alter table story_items add constraint story_items_media_type_check
  check (media_type in ('image', 'video'));

alter table story_items add column if not exists poster_url text;
alter table story_items drop constraint if exists story_items_video_poster;
alter table story_items add constraint story_items_video_poster
  check (media_type = 'image' or poster_url is not null);

comment on column story_items.image_url is
  'Адрес фото слайда — или ролика, если media_type = video (имя колонки историческое)';
comment on column story_items.media_type is 'image — фото, video — ролик (MP4, пережат сервером)';
comment on column story_items.poster_url is
  'Кадр-обложка ролика: кружок на главной, показ до загрузки и вместо ролика, если браузер его не покажет';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-videos', 'story-videos', true, 200 * 1024 * 1024,
  array['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/x-m4v']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

commit;
