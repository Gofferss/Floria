-- ================================================================
-- Чтобы обращение клиента нельзя было потерять молча.
--
-- Форма обратной связи НИЧЕГО не сохраняла: сообщение уходило только
-- уведомлением в Telegram, «вдогонку», без ожидания результата. Не ушло —
-- и вопрос клиента исчезал совсем, при этом человек видел «спасибо,
-- мы свяжемся». У заказа хотя бы оставалась строка в базе; здесь не
-- оставалось ничего.
--
-- Порядок теперь обратный: сначала записываем, потом уведомляем. Сбой
-- уведомления перестаёт быть потерей — становится просто задержкой,
-- которую видно и можно доотправить.
--
-- staff_notified_at на заказах — для того же: отличить «сообщили
-- флористу» от «не сообщили», чтобы фоновая задача могла добрать
-- пропущенное, а не полагаться на удачу первой попытки.
-- ================================================================

create table if not exists contact_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  message text not null,
  -- когда сотрудников успешно оповестили; null = ещё нет
  staff_notified_at timestamptz,
  -- сколько раз пытались оповестить (для порога тревоги)
  notify_attempts integer not null default 0,
  -- когда сотрудник отметил обращение обработанным
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table contact_requests is
  'Обращения из формы обратной связи. Пишутся ДО отправки уведомления — сбой Telegram не должен терять вопрос клиента.';

create index if not exists contact_requests_pending_idx
  on contact_requests (created_at)
  where staff_notified_at is null;

create index if not exists contact_requests_unhandled_idx
  on contact_requests (created_at desc)
  where handled_at is null;

alter table orders add column if not exists staff_notified_at timestamptz;

comment on column orders.staff_notified_at is
  'Когда о заказе успешно сообщили сотрудникам. null — не сообщили, задача добора подхватит.';

create index if not exists orders_not_notified_idx
  on orders (created_at)
  where staff_notified_at is null;

-- ================================================================
-- Доступ. Включённой RLS здесь МАЛО — у ролей anon/authenticated по
-- умолчанию есть гранты на все таблицы схемы public, а RLS работает
-- построчно, а не поколоночно. Именно эта пара однажды дала дыру с
-- бонусами. Поэтому гранты снимаем явно, а не полагаемся на политики.
--
-- Писать сюда должен только сервер (service_role, в обход RLS), читать —
-- только сотрудники. Клиент отправляет форму через наш маршрут, напрямую
-- в таблицу он не ходит.
-- ================================================================

alter table contact_requests enable row level security;

revoke all on contact_requests from anon, authenticated;

drop policy if exists "Сотрудники читают обращения" on contact_requests;
create policy "Сотрудники читают обращения"
  on contact_requests for select
  using (public.is_staff());

drop policy if exists "Сотрудники отмечают обращения обработанными" on contact_requests;
create policy "Сотрудники отмечают обращения обработанными"
  on contact_requests for update
  using (public.is_staff())
  with check (public.is_staff());

grant select, update on contact_requests to authenticated;
