-- Прогон 032_payroll.sql вместе с тестом в одной транзакции, с откатом.
-- Проверяет миграцию на боевой базе до того, как её применить. Сгенерирован scratch-скриптом.
begin;
-- ================================================================
-- 032: зарплата по схемам.
--
-- Владелец: «оплата сотрудникам настраивается по-разному на человека:
-- "Таня: 5% от продаж + фикс 50 000", "Даня: 5 500 за смену"». Поэтому
-- схема — набор частей, а не одна формула:
--
--   * monthly       — оклад за месяц (по дням месяца, если схема сменилась
--                     в середине);
--   * per_shift     — за каждый отработанный день;
--   * sales_percent — процент от продаж: своих (own), всей точки в его дни
--                     (shift_days) или всей точки за месяц (store);
--   * per_bouquet   — за каждый собранный букет;
--   * per_delivery  — за каждую доставку.
--
-- Схема меняется «с даты»: старые части закрываются накануне, новые
-- действуют с неё. Так прошлые месяцы считаются по тем правилам, что были
-- тогда, — смена ставки в ноябре не переписывает октябрь.
--
-- Табель (hr_work_days) хранит только то, что знает сам Учёт: вход по PIN
-- на айпаде и ручные правки владельца. Дни из смен Posiflora считаются на
-- лету и правятся той же ручной отметкой (worked = false — «не работал»).
--
-- Выдачи из кассы Учёта уже пишутся в pos_cash_movements (причина
-- «Зарплата», paid_employee_id). Здесь — выдачи мимо кассы: картой,
-- переводом, наличными до запуска Учёта.
--
-- Безопасность — как в 024: RLS без политик, гранты сняты с anon и
-- authenticated, доступ и функции — только service_role.
-- ================================================================


-- Связь с сотрудником Posiflora: до запуска личные продажи и смены
-- берутся оттуда.
alter table hr_employees add column if not exists posiflora_worker_id text;
create unique index if not exists hr_employees_posiflora_worker on hr_employees (posiflora_worker_id) where posiflora_worker_id is not null;

comment on column hr_employees.posiflora_worker_id is 'Сотрудник Posiflora — до запуска Учёта продажи и смены человека берутся оттуда.';

create table if not exists hr_pay_rules (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references hr_employees(id) on delete cascade,
  kind         text not null check (kind in ('monthly', 'per_shift', 'sales_percent', 'per_bouquet', 'per_delivery')),
  amount       numeric(12,2) check (amount >= 0),
  percent      numeric(5,2) check (percent > 0 and percent <= 100),
  base         text check (base in ('own', 'shift_days', 'store')),
  valid_from   date not null,
  -- Последний день действия включительно; пусто — действует.
  valid_to     date,
  created_at   timestamptz not null default now(),
  created_by   uuid references staff(id) on delete set null,
  constraint hr_pay_rules_shape check (
    (kind = 'sales_percent' and percent is not null and base is not null and amount is null)
    or (kind <> 'sales_percent' and amount is not null and percent is null and base is null)
  ),
  constraint hr_pay_rules_dates check (valid_to is null or valid_to >= valid_from)
);

create index if not exists hr_pay_rules_employee on hr_pay_rules (employee_id, valid_from);

comment on table hr_pay_rules is 'Части схемы оплаты человека с датами действия. Меняется через hr_set_pay_scheme.';

create table if not exists hr_work_days (
  employee_id  uuid not null references hr_employees(id) on delete cascade,
  day          date not null,
  -- false — «не работал», хотя смена Posiflora или вход по PIN говорят иное.
  worked       boolean not null,
  source       text not null check (source in ('pin', 'manual')),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references staff(id) on delete set null,
  primary key (employee_id, day)
);

comment on table hr_work_days is 'Табель: входы по PIN и ручные отметки владельца. Дни из смен Posiflora считаются на лету.';

create table if not exists hr_pay_adjustments (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references hr_employees(id) on delete cascade,
  -- Первое число месяца, к которому относится.
  month        date not null check (extract(day from month) = 1),
  -- Плюс — премия, минус — удержание.
  amount       numeric(12,2) not null check (amount <> 0),
  comment      text not null check (length(trim(comment)) > 0),
  created_at   timestamptz not null default now(),
  created_by   uuid references staff(id) on delete set null
);

create index if not exists hr_pay_adjustments_month on hr_pay_adjustments (employee_id, month);

comment on table hr_pay_adjustments is 'Премии (+) и удержания (−) за месяц, с причиной.';

create table if not exists hr_payouts (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references hr_employees(id) on delete cascade,
  paid_on      date not null,
  amount       numeric(12,2) not null check (amount > 0),
  method       text not null check (method in ('cash', 'card', 'transfer', 'other')),
  comment      text,
  created_at   timestamptz not null default now(),
  created_by   uuid references staff(id) on delete set null
);

create index if not exists hr_payouts_employee on hr_payouts (employee_id, paid_on);

comment on table hr_payouts is 'Выдачи зарплаты мимо кассы Учёта (из кассы — pos_cash_movements).';

-- ----------------------------------------------------------------
-- Новая схема с даты — одним действием: закрыть действующие части
-- накануне, убрать начатые с этой даты и позже, записать новые.
-- ----------------------------------------------------------------
create or replace function hr_set_pay_scheme(p_employee uuid, p_from date, p_rules jsonb, p_staff uuid default null)
returns void
language plpgsql
as $$
declare
  r jsonb;
begin
  if p_from is null then
    raise exception 'Нужна дата, с которой действует схема';
  end if;
  perform 1 from hr_employees where id = p_employee for update;
  if not found then
    raise exception 'Сотрудник не найден';
  end if;
  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' then
    raise exception 'Части схемы — списком';
  end if;

  delete from hr_pay_rules where employee_id = p_employee and valid_from >= p_from;
  update hr_pay_rules
     set valid_to = p_from - 1
   where employee_id = p_employee
     and valid_from < p_from
     and (valid_to is null or valid_to >= p_from);

  for r in select * from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) loop
    insert into hr_pay_rules (employee_id, kind, amount, percent, base, valid_from, created_by)
    values (
      p_employee,
      r->>'kind',
      nullif(r->>'amount', '')::numeric,
      nullif(r->>'percent', '')::numeric,
      nullif(r->>'base', ''),
      p_from,
      p_staff
    );
  end loop;
end;
$$;

alter table hr_pay_rules enable row level security;
alter table hr_work_days enable row level security;
alter table hr_pay_adjustments enable row level security;
alter table hr_payouts enable row level security;

revoke all on hr_pay_rules, hr_work_days, hr_pay_adjustments, hr_payouts from anon, authenticated;
grant select, insert, update, delete on hr_pay_rules, hr_work_days, hr_pay_adjustments, hr_payouts to service_role;

revoke all on function hr_set_pay_scheme(uuid, date, jsonb, uuid) from public, anon, authenticated;
grant execute on function hr_set_pay_scheme(uuid, date, jsonb, uuid) to service_role;


-- Тест 032: схемы оплаты с датами, табель, права.
-- Гоняется в транзакции с откатом (см. 028_dryrun.sql) — данных не оставляет.

do $$
declare
  v_emp uuid;
  v_n integer;
begin
  insert into hr_employees (full_name, short_name) values ('Тест Зарплата', 'Тест') returning id into v_emp;

  -- 1. Схема с 1 октября: оклад + 5% своих продаж.
  perform hr_set_pay_scheme(v_emp, '2026-10-01', '[{"kind":"monthly","amount":50000},{"kind":"sales_percent","percent":5,"base":"own"}]');
  select count(*) into v_n from hr_pay_rules where employee_id = v_emp and valid_to is null;
  if v_n <> 2 then raise exception '032.1: ожидалось 2 действующие части, есть %', v_n; end if;

  -- 2. С 1 ноября — за смену: октябрьские части закрыты 31 октября.
  perform hr_set_pay_scheme(v_emp, '2026-11-01', '[{"kind":"per_shift","amount":5500}]');
  select count(*) into v_n from hr_pay_rules where employee_id = v_emp and valid_from = '2026-10-01' and valid_to = '2026-10-31';
  if v_n <> 2 then raise exception '032.2: октябрьские части не закрыты накануне (%)', v_n; end if;
  select count(*) into v_n from hr_pay_rules where employee_id = v_emp and valid_from = '2026-11-01' and valid_to is null and kind = 'per_shift';
  if v_n <> 1 then raise exception '032.2: ноябрьской части нет'; end if;

  -- 3. Поправка с той же даты заменяет ноябрь и не трогает октябрь.
  perform hr_set_pay_scheme(v_emp, '2026-11-01', '[{"kind":"per_shift","amount":6000},{"kind":"per_delivery","amount":300}]');
  select count(*) into v_n from hr_pay_rules where employee_id = v_emp and valid_from = '2026-11-01';
  if v_n <> 2 then raise exception '032.3: после поправки в ноябре % частей, ожидалось 2', v_n; end if;
  if (select amount from hr_pay_rules where employee_id = v_emp and kind = 'per_shift') <> 6000 then
    raise exception '032.3: ставка за смену не заменилась';
  end if;
  select count(*) into v_n from hr_pay_rules where employee_id = v_emp and valid_from = '2026-10-01';
  if v_n <> 2 then raise exception '032.3: октябрь задет поправкой ноября'; end if;

  -- 4. Пустая схема с даты — человек с неё без оплаты, прошлое цело.
  perform hr_set_pay_scheme(v_emp, '2026-12-01', '[]');
  select count(*) into v_n from hr_pay_rules where employee_id = v_emp and valid_to is null;
  if v_n <> 0 then raise exception '032.4: после пустой схемы остались действующие части'; end if;

  -- 5. Процент без основы не принимается.
  begin
    perform hr_set_pay_scheme(v_emp, '2027-01-01', '[{"kind":"sales_percent","percent":5}]');
    raise exception '032.5: процент без основы прошёл';
  exception when check_violation then null;
  end;

  -- 6. Табель: один день — одна строка, ручная отметка перекрывает.
  insert into hr_work_days (employee_id, day, worked, source) values (v_emp, '2026-10-05', true, 'pin');
  insert into hr_work_days (employee_id, day, worked, source) values (v_emp, '2026-10-05', true, 'pin') on conflict do nothing;
  insert into hr_work_days (employee_id, day, worked, source) values (v_emp, '2026-10-05', false, 'manual')
    on conflict (employee_id, day) do update set worked = excluded.worked, source = excluded.source;
  if (select worked from hr_work_days where employee_id = v_emp and day = '2026-10-05') then
    raise exception '032.6: ручная отметка «не работал» не перекрыла вход';
  end if;

  -- 7. Премия без причины и нулевая выдача не принимаются.
  begin
    insert into hr_pay_adjustments (employee_id, month, amount, comment) values (v_emp, '2026-10-01', 1000, '  ');
    raise exception '032.7: премия без причины прошла';
  exception when check_violation then null;
  end;
  begin
    insert into hr_payouts (employee_id, paid_on, amount, method) values (v_emp, '2026-10-10', 0, 'cash');
    raise exception '032.7: нулевая выдача прошла';
  exception when check_violation then null;
  end;

  -- 8. Клиентские роли не видят таблиц и не вызывают функцию.
  if has_table_privilege('anon', 'hr_pay_rules', 'select')
     or has_table_privilege('authenticated', 'hr_payouts', 'select')
     or has_function_privilege('anon', 'hr_set_pay_scheme(uuid, date, jsonb, uuid)', 'execute') then
    raise exception '032.8: у клиентских ролей есть доступ к зарплате';
  end if;

  raise notice '032: все 8 проверок прошли';
end $$;

rollback;
