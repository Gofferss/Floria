-- Прогон 036_story_video.sql вместе с тестом в одной транзакции, с откатом.
-- Проверяет миграцию на боевой базе до того, как её применить. Сгенерирован scratch-скриптом.
begin;
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


-- ================================================================
-- Проверка миграции 036 (видео в сторис). Откатывается.
-- ================================================================



do $$
declare
  st uuid;
begin
  insert into stories (title, is_active) values ('ТЕСТ видео', false) returning id into st;

  -- 1. Старый способ записи (без media_type) — по-прежнему фото.
  insert into story_items (story_id, image_url) values (st, 'https://example.invalid/a.jpg');
  if (select media_type from story_items where story_id = st) <> 'image' then raise exception 'ТЕСТ 1: слайд без типа — не фото'; end if;
  raise notice 'OK 1: слайд без указания типа остаётся фото';

  -- 2. Видео без обложки не пускаем.
  begin
    insert into story_items (story_id, image_url, media_type) values (st, 'https://example.invalid/v.mp4', 'video');
    raise exception 'ТЕСТ 2: видео без обложки записалось';
  exception when check_violation then null;
  end;
  raise notice 'OK 2: видео без обложки не записывается';

  -- 3. Видео с обложкой — записывается.
  insert into story_items (story_id, image_url, media_type, poster_url, duration_seconds)
  values (st, 'https://example.invalid/v.mp4', 'video', 'https://example.invalid/v.jpg', 12);
  raise notice 'OK 3: видео с обложкой записывается';

  -- 4. Неизвестный тип — нет.
  begin
    insert into story_items (story_id, image_url, media_type) values (st, 'https://example.invalid/g.gif', 'gif');
    raise exception 'ТЕСТ 4: неизвестный тип записался';
  exception when check_violation then null;
  end;
  raise notice 'OK 4: неизвестный тип не записывается';

  -- 5. Витрина читает новые колонки анонимно.
  if not (has_column_privilege('anon', 'public.story_items', 'media_type', 'SELECT')
          and has_column_privilege('anon', 'public.story_items', 'poster_url', 'SELECT')) then
    raise exception 'ТЕСТ 5: аноним не читает новые колонки';
  end if;
  raise notice 'OK 5: новые колонки читаются витриной';

  -- 6. Корзина роликов: публичная, только видео, до 200 МБ.
  if not exists (select 1 from storage.buckets where id = 'story-videos' and public and file_size_limit = 209715200
                 and 'video/quicktime' = any (allowed_mime_types) and not ('image/svg+xml' = any (allowed_mime_types))) then
    raise exception 'ТЕСТ 6: корзина story-videos настроена не так';
  end if;
  raise notice 'OK 6: корзина story-videos — только видео до 200 МБ';

  raise notice '036: все 6 проверок прошли';
end $$;


rollback;
