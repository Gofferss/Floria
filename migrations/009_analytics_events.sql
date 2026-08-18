-- ================================================================
-- 009 — Метрики: клики по кнопкам, просмотры букетов, добавления в
-- корзину, открытия сторис.
--
-- ПРО КУКИ: сознательно НЕ используем ни куки, ни какой-либо
-- устойчивый идентификатор посетителя (localStorage-ID, отпечаток
-- браузера и т.п.) — событие анонимно: тип действия + что именно
-- (название кнопки/товара) + путь страницы + время. Это агрегированная
-- статистика ("кнопку X нажали 40 раз"), а не слежение за конкретным
-- человеком между визитами, поэтому дополнительное согласие на
-- обработку персональных данных / баннер про куки для этого не нужен —
-- уже существующая политика конфиденциальности (/privacy) это покрывает.
-- Если в будущем понадобится вести историю конкретного посетителя
-- (воронки, персонализация) — это уже другая задача с другими
-- юридическими требованиями, начинать её сейчас не нужно.
--
-- Идемпотентно — безопасно выполнять повторно.
-- ================================================================

begin;

create table if not exists analytics_events (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null,
  target      text not null,
  page_path   text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_analytics_events_type_created on analytics_events (event_type, created_at desc);
create index if not exists idx_analytics_events_target        on analytics_events (target);

-- Пишет и читает только service-role (запись — через /api/analytics/track,
-- чтение — только /admin/analytics) — тот же паттерн deny-by-default, что
-- у staff/bot_*/promo_codes.
alter table analytics_events enable row level security;

commit;
