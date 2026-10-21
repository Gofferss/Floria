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
