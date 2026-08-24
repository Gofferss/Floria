-- ================================================================
-- Кнопка со ссылкой на слайде истории.
--
-- Зачем: истории вроде «Каталог в Telegram» или «Наш бот» должны
-- вести куда-то, а не только показывать картинку. Кнопка
-- необязательна — слайд без неё работает как раньше.
--
-- Обе колонки nullable и без значения по умолчанию: у всех
-- существующих слайдов кнопки нет, и это нормальное состояние, а не
-- «не заполнено». Кнопка показывается, только когда задан link_url.
-- ================================================================

alter table story_items
  add column if not exists link_url text,
  add column if not exists link_label text;

-- Защита на уровне БД, а не только формы: в link_url допустимы лишь
-- http(s)-адреса и внутренние пути. Без этого ограничения в поле мог бы
-- оказаться javascript:-адрес, который выполнил бы код в браузере
-- посетителя при клике по кнопке. Проверка в форме — удобство, эта
-- проверка — гарантия.
alter table story_items
  drop constraint if exists story_items_link_url_scheme;

alter table story_items
  add constraint story_items_link_url_scheme
  check (
    link_url is null
    or link_url ~ '^https?://'
    or link_url ~ '^/[^/]'
  );

comment on column story_items.link_url is
  'Куда ведёт кнопка слайда. http(s) или внутренний путь вида /catalog. NULL — кнопки нет.';
comment on column story_items.link_label is
  'Надпись на кнопке. Если пусто, а ссылка задана — показывается «Подробнее».';
