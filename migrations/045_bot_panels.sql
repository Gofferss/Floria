-- ================================================================
-- 045. Панель владельца в Telegram — какому чату и в каком сообщении.
--
-- Бот присылает владельцу живую карточку (виджет Bot API 10.4) с вкладками
-- «Сегодня / Заказы / Деньги»; данные карточка запрашивает у бота сама.
-- Отвечаем только карточке, записанной здесь: чат + сообщение. Без этого
-- любой, кто нашёл бота, не получит выручку и заказы — их просто негде
-- запросить. Одна панель на чат: новая заменяет прежнюю.
-- ================================================================
begin;

create table if not exists public.bot_panels (
  chat_id     bigint primary key,
  message_id  bigint not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.bot_panels is
  'Панель владельца в Telegram: чат и сообщение с карточкой — отвечаем только ей (lib/telegram/owner-panel.ts)';

drop trigger if exists bot_panels_updated_at on public.bot_panels;
create trigger bot_panels_updated_at before update on public.bot_panels
  for each row execute function set_updated_at();

alter table public.bot_panels enable row level security;
revoke all on public.bot_panels from anon, authenticated;
grant select, insert, update, delete on public.bot_panels to service_role;

commit;
