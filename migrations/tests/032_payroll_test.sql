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
