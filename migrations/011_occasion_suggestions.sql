-- ================================================================
-- 011 — Подсказка "похоже на ежегодный повод" в боте.
--
-- bot_users.phone       — телефон, подтверждённый кодом из СМС при
--                          проверке бонусного баланса (см. вебхук).
--                          Без unique: один и тот же номер может
--                          законно подтвердить не один чат (например,
--                          если человек сменил Telegram-аккаунт) —
--                          жёсткий запрет тут не нужен, а сбой апдейта
--                          не должен ломать сам показ баланса.
--
-- bot_occasion_dismissals — "не сейчас" по конкретной паре день/месяц,
--                          чтобы не предлагать то же самое повторно
--                          при каждой следующей проверке баланса.
-- ================================================================

begin;

alter table bot_users add column if not exists phone text;

create table if not exists bot_occasion_dismissals (
  chat_id      bigint not null references bot_users(chat_id) on delete cascade,
  event_month  smallint not null check (event_month between 1 and 12),
  event_day    smallint not null check (event_day between 1 and 31),
  created_at   timestamptz not null default now(),
  primary key (chat_id, event_month, event_day)
);

commit;
