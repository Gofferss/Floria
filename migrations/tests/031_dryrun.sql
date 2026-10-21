-- Прогон 031_owner_summary.sql вместе с тестом в одной транзакции, с откатом.
-- Проверяет миграцию на боевой базе до того, как её применить. Сгенерирован scratch-скриптом.
begin;
-- ================================================================
-- 031: «Сводка» для владельцев.
--
-- Цифры сводки берутся из трёх мест: Posiflora (пока касса там),
-- Учёт (после запуска) и оплаченные заказы сайта. Здесь — то немногое,
-- чего ни в одном из них нет и что владелец вписывает руками:
--
--   * summary_income_extra — доход за год, которого нет ни в одной
--     системе. В 2026 это январь–март: история Posiflora начинается
--     с апреля. Без этой суммы счётчик порога 20 млн ₽ за год врёт
--     в меньшую сторону — опасная сторона.
--   * pos_settings.posiflora_payment_names — названия способов оплаты
--     Posiflora. Их API отдаёт доли по способам, но сами способы не
--     отдаёт (/payment-methods — 500, include — 422), так что подписать
--     «48% — это карта» может только владелец.
--   * pos_settings.summary_uchet_since — с какого дня выручку считать по
--     Учёту, а не по Posiflora. Пусто — всё по Posiflora. Одна дата
--     вместо «сложить обе»: в месяц параллельной работы продажи бьются
--     в обеих кассах, и сумма посчитала бы их дважды.
--
-- Безопасность — как в 024: RLS без политик, гранты сняты с anon и
-- authenticated, доступ только у service_role.
-- ================================================================


create table if not exists summary_income_extra (
  year        integer primary key check (year between 2020 and 2100),
  amount      numeric(14,2) not null default 0 check (amount >= 0),
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff(id) on delete set null
);

comment on table summary_income_extra is
  'Доход за год вне систем (до Posiflora и т.п.). Вписывает владелец в «Сводке».';

alter table pos_settings add column if not exists posiflora_payment_names jsonb not null default '{}'::jsonb;
alter table pos_settings add column if not exists summary_uchet_since date;

comment on column pos_settings.posiflora_payment_names is
  'Названия способов оплаты Posiflora: { "<id способа>": "Карта" }. API Posiflora их не отдаёт.';
comment on column pos_settings.summary_uchet_since is
  'С этого дня «Сводка» считает выручку по Учёту, до него — по Posiflora. Пусто — всё по Posiflora.';

alter table summary_income_extra enable row level security;
revoke all on summary_income_extra from anon, authenticated;
grant select, insert, update, delete on summary_income_extra to service_role;


-- Тест 031: таблица дохода вне систем и настройки сводки.
-- Гоняется в транзакции с откатом (см. 028_dryrun.sql) — данных не оставляет.

do $$
declare
  v_names jsonb;
  v_since date;
begin
  -- 1. Сумма за год сохраняется и обновляется по году.
  insert into summary_income_extra (year, amount, note) values (2026, 1000, 'январь–март')
    on conflict (year) do update set amount = excluded.amount;
  insert into summary_income_extra (year, amount) values (2026, 2500)
    on conflict (year) do update set amount = excluded.amount;
  if (select amount from summary_income_extra where year = 2026) <> 2500 then
    raise exception '031.1: сумма за год не обновилась';
  end if;

  -- 2. Отрицательный доход не принимается.
  begin
    insert into summary_income_extra (year, amount) values (2027, -1);
    raise exception '031.2: отрицательная сумма прошла';
  exception when check_violation then null;
  end;

  -- 3. Настройки сводки: по умолчанию пусто, пишутся.
  select posiflora_payment_names, summary_uchet_since into v_names, v_since from pos_settings;
  if v_names is null or v_since is not null then
    raise exception '031.3: умолчания настроек не те: % / %', v_names, v_since;
  end if;
  update pos_settings set posiflora_payment_names = posiflora_payment_names || '{"abc": "Карта"}'::jsonb;
  if (select posiflora_payment_names->>'abc' from pos_settings) <> 'Карта' then
    raise exception '031.3: название способа не записалось';
  end if;

  -- 4. Клиентские роли таблицу не видят.
  if has_table_privilege('anon', 'summary_income_extra', 'select')
     or has_table_privilege('authenticated', 'summary_income_extra', 'select') then
    raise exception '031.4: у anon/authenticated есть доступ к summary_income_extra';
  end if;

  raise notice '031: все 4 проверки прошли';
end $$;

rollback;
