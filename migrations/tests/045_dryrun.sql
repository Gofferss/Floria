-- Прогон 045_bot_panels.sql вместе с тестом в одной транзакции, с откатом.
-- Проверяет миграцию на боевой базе до того, как её применить. Сгенерирован scratch-скриптом.
begin;
-- ================================================================
-- 045. Панель владельца в Telegram — какому чату и в каком сообщении.
--
-- Бот присылает владельцу живую карточку (виджет Bot API 10.4) с вкладками
-- «Сегодня / Заказы / Деньги»; данные карточка запрашивает у бота сама.
-- Отвечаем только карточке, записанной здесь: чат + сообщение. Без этого
-- любой, кто нашёл бота, не получит выручку и заказы — их просто негде
-- запросить. Одна панель на чат: новая заменяет прежнюю.
-- ================================================================

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


-- Проверка миграции 045. Откатывается.

do $$
begin
  insert into public.bot_panels (chat_id, message_id) values (1, 10);
  insert into public.bot_panels (chat_id, message_id) values (1, 11)
    on conflict (chat_id) do update set message_id = excluded.message_id;
  if (select message_id from public.bot_panels where chat_id = 1) <> 11 then raise exception 'Новая панель не заменила прежнюю'; end if;
  if has_table_privilege('anon', 'public.bot_panels', 'select') or has_table_privilege('authenticated', 'public.bot_panels', 'select') then
    raise exception 'Панели видны снаружи';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.bot_panels'::regclass) then raise exception 'Нет RLS'; end if;
  raise notice 'Одна панель на чат, снаружи не видно';
end $$;

select 'ВСЕ ПРОВЕРКИ 045 ПРОШЛИ' as result;


rollback;
