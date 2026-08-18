-- ================================================================
-- 005 — Бот-напоминальщик в Telegram
--
-- bot_users      — все, кто хоть раз нажал /start. Источник списка для
--                   рассылок (8 марта и т.п.), даже если у человека нет
--                   ни одного активного напоминания.
-- bot_reminders  — сами напоминания. Дата хранится как month+day (не
--                   полная дата) — событие ежегодное (день рождения,
--                   годовщина), конкретный год не имеет значения.
--                   last_notified_year не даёт напомнить дважды за один
--                   и тот же год, если /api/telegram/send-due-reminders
--                   вызовут больше одного раза в день.
-- bot_sessions   — состояние диалога между сообщениями. Вебхук Telegram
--                   стейтлесс (каждое сообщение — отдельный HTTP-запрос),
--                   поэтому "жду от пользователя дату" нужно где-то
--                   хранить между запросами.
--
-- RLS не включаем — эти таблицы читает/пишет только сервер через
-- service-role (webhook и cron), обычным ключом сюда никто не должен
-- попадать вообще, ни на чтение, ни на запись.
-- ================================================================

begin;

create table if not exists bot_users (
  chat_id     bigint primary key,
  first_name  text,
  username    text,
  is_blocked  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists bot_reminders (
  id                  uuid primary key default gen_random_uuid(),
  chat_id             bigint not null references bot_users(chat_id) on delete cascade,
  title               text not null,
  event_month         smallint not null check (event_month between 1 and 12),
  event_day           smallint not null check (event_day between 1 and 31),
  remind_days_before  smallint not null default 10,
  last_notified_year  smallint,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_bot_reminders_chat_id on bot_reminders (chat_id);

create table if not exists bot_sessions (
  chat_id     bigint primary key references bot_users(chat_id) on delete cascade,
  state       text not null default 'idle',
  pending     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_bot_reminders_updated_at on bot_reminders;
create trigger trg_bot_reminders_updated_at
  before update on bot_reminders for each row execute function set_updated_at();

drop trigger if exists trg_bot_sessions_updated_at on bot_sessions;
create trigger trg_bot_sessions_updated_at
  before update on bot_sessions for each row execute function set_updated_at();

commit;
