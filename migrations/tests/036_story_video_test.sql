-- ================================================================
-- Проверка миграции 036 (видео в сторис). Откатывается.
-- ================================================================

\set ON_ERROR_STOP on

begin;

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
