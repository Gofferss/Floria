-- ================================================================
-- 008 — Промокоды и «сторис» на главной
--
-- ПРОМОКОДЫ: изучили реальное API Посифлоры (posiflora.com/api) —
-- там нет ни промокодов, ни купонов вообще, ни как ресурса, ни как
-- поля заказа. Есть только: (а) discount/discountType на самом товаре
-- (кассир вручную скидывает цену конкретного букета), (б) discountGroup/
-- bonusGroup — тарифные группы клиента, назначаются в панели Посифлоры
-- вручную, (в) byBonuses/bonusesAmount — списание бонусных баллов.
-- Значит, промокод в духе "клиент вводит код на сайте" — это ЧИСТО
-- наша, сайтовая сущность, синхронизировать с Посифлорой нечего.
-- Сумма скидки просто уменьшает total_amount заказа, как и бонусы.
--
-- promo_code_redemptions — отдельная таблица, а не счётчик на самой
-- promo_codes, чтобы проверять лимит "на одного клиента" (по телефону)
-- и хранить историю, кто когда каким промокодом воспользовался.
--
-- СТОРИС: stories — один кружок (обложка + заголовок), story_items —
-- фото внутри него по порядку, как слайды в Instagram-актуальном.
-- Бакет product-images уже есть (см. 006) — переиспользуем его под
-- папку stories/, отдельный бакет ради этого заводить незачем.
--
-- Идемпотентно — безопасно выполнять повторно.
-- ================================================================

begin;

create table if not exists promo_codes (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique,
  description             text,
  discount_type           text not null check (discount_type in ('percent', 'fixed')),
  discount_value          numeric(10,2) not null check (discount_value > 0),
  min_order_amount        numeric(10,2) not null default 0 check (min_order_amount >= 0),
  max_uses                int check (max_uses is null or max_uses > 0),
  max_uses_per_customer   int check (max_uses_per_customer is null or max_uses_per_customer > 0),
  valid_from              timestamptz,
  valid_until             timestamptz,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table promo_codes is 'Промокоды — сайтовая сущность, в Посифлоре аналога нет (см. комментарий выше)';

create table if not exists promo_code_redemptions (
  id                      uuid primary key default gen_random_uuid(),
  promo_code_id           uuid not null references promo_codes(id) on delete cascade,
  order_id                uuid references orders(id) on delete set null,
  customer_phone          text not null,
  discount_amount         numeric(10,2) not null,
  created_at              timestamptz not null default now()
);

create index if not exists idx_promo_redemptions_code    on promo_code_redemptions (promo_code_id);
create index if not exists idx_promo_redemptions_phone   on promo_code_redemptions (customer_phone);
create index if not exists idx_promo_codes_code          on promo_codes (code);

create table if not exists stories (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null,
  cover_image             text,
  sort_order              int not null default 0,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table if not exists story_items (
  id                      uuid primary key default gen_random_uuid(),
  story_id                uuid not null references stories(id) on delete cascade,
  image_url               text not null,
  sort_order              int not null default 0,
  duration_seconds        int not null default 5 check (duration_seconds > 0),
  created_at              timestamptz not null default now()
);

create index if not exists idx_story_items_story on story_items (story_id);

-- updated_at триггер — та же функция set_updated_at(), что уже
-- используется для products/orders/etc (миграция 001).
drop trigger if exists trg_promo_codes_updated_at on promo_codes;
create trigger trg_promo_codes_updated_at
  before update on promo_codes
  for each row execute function set_updated_at();

drop trigger if exists trg_stories_updated_at on stories;
create trigger trg_stories_updated_at
  before update on stories
  for each row execute function set_updated_at();

-- ================================================================
-- RLS
-- ================================================================
-- promo_codes/promo_code_redemptions — читает и пишет только service-role
-- (проверка кода идёт через API-роут на сервере, не напрямую из браузера) —
-- RLS enabled без политик, тот же паттерн, что у staff/bot_*.
alter table promo_codes enable row level security;
alter table promo_code_redemptions enable row level security;

-- stories/story_items — публичное чтение активных, как у products/categories.
alter table stories enable row level security;
alter table story_items enable row level security;

drop policy if exists "public_read_active_stories" on stories;
create policy "public_read_active_stories"
  on stories for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "public_read_story_items" on story_items;
create policy "public_read_story_items"
  on story_items for select
  to anon, authenticated
  using (exists (select 1 from stories s where s.id = story_id and s.is_active = true));

commit;
