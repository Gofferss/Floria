-- ================================================================
-- Проверка бонусов (миграция 033). Транзакция откатывается — настройки
-- и балансы настоящих клиентов не меняются.
-- ================================================================

\set ON_ERROR_STOP on

begin;

do $$
declare
  loc    uuid;
  trn    uuid;
  emp    uuid;
  a      uuid;
  doc    uuid;
  sh     uuid;
  sht    uuid;
  cust   uuid;
  s1     uuid := 'd0000000-0000-4000-8000-000000000001';
  s2     uuid := 'd0000000-0000-4000-8000-000000000002';
  o1     uuid := 'd0000000-0000-4000-8000-000000000011';
  res    jsonb;
  bal    numeric;
  n      integer;
  pay    jsonb;
begin
  insert into inv_locations (title) values ('ТЕСТ бонусы') returning id into loc;
  insert into inv_locations (title, is_training) values ('ТЕСТ бонусы тренировка', true) returning id into trn;
  insert into hr_employees (full_name, short_name) values ('ТЕСТ Бонусы', 'Бонусы') returning id into emp;
  insert into inv_items (title, sale_price) values ('ТЕСТ роза для бонусов', 200) returning id into a;
  insert into inv_documents (doc_type, location_id, payment_method) values ('receipt', loc, 'cash') returning id into doc;
  insert into inv_document_lines (document_id, item_id, qty, unit_cost, sort) values (doc, a, 50, 80, 1);
  perform inv_post_document(doc, null);
  sh := pos_open_shift(null, loc, 1000, null, emp);
  sht := pos_open_shift(null, trn, 1000, null, emp);
  insert into customers (phone, full_name, bonus_balance) values ('+79990003301', 'ТЕСТ Бонусная', 300) returning id into cust;
  update pos_settings set bonuses_enabled = false, bonuses_since = null, bonus_percent = 5, bonus_max_percent = 100;

  -- 1. Пока бонусы у Posiflora — списать их в кассе нельзя.
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh, 'customer_id', cust, 'bonus_used', 10),
      jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 190)), null, emp);
    raise exception 'ТЕСТ 1: списание при выключенных бонусах прошло';
  exception when others then
    if sqlerrm not like '%Posiflora%' then raise; end if;
  end;
  raise notice 'OK 1: при выключенных бонусах списание не проходит';

  -- 2. Переход: остаток 300 записан движением «перенос», баланс прежний.
  n := bonus_enable(null);
  if n < 1 then raise exception 'ТЕСТ 2: перенос не записал ни одного остатка'; end if;
  if not exists (select 1 from customer_bonus_moves where customer_id = cust and kind = 'import' and delta = 300) then
    raise exception 'ТЕСТ 2: нет движения «перенос» на 300';
  end if;
  if (select bonus_balance from customers where id = cust) <> 300 then raise exception 'ТЕСТ 2: баланс изменился при переносе'; end if;
  if bonus_enable(null) <> 0 then raise exception 'ТЕСТ 2: повторное включение что-то записало'; end if;
  raise notice 'OK 2: переход записал остатки и не повторяется';

  -- 3. Продажа клиенту: 2 × 200 = 400 → +20 (5%).
  res := pos_record_sale(jsonb_build_object('id', s1, 'shift_id', sh, 'customer_id', cust),
    jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 2)),
    jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 400)), null, emp);
  if (res->>'bonus_earned')::numeric <> 20 then raise exception 'ТЕСТ 3: начислено % вместо 20', res->>'bonus_earned'; end if;
  select bonus_balance into bal from customers where id = cust;
  if bal <> 320 then raise exception 'ТЕСТ 3: баланс % вместо 320', bal; end if;
  raise notice 'OK 3: за 400 ₽ начислено 20, баланс 320';

  -- 4. Оплата бонусами: 400 − 100 бонусов = 300 деньгами, начислено 15 (от денег).
  res := pos_record_sale(jsonb_build_object('id', s2, 'shift_id', sh, 'customer_id', cust, 'bonus_used', 100),
    jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 2)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300)), null, emp);
  select bonus_balance into bal from customers where id = cust;
  if bal <> 235 then raise exception 'ТЕСТ 4: баланс % вместо 235', bal; end if;
  if (select total from pos_sales where id = s2) <> 300 or (select bonus_used from pos_sales where id = s2) <> 100 then
    raise exception 'ТЕСТ 4: в чеке не та сумма или списание';
  end if;
  raise notice 'OK 4: 100 бонусами + 300 деньгами, начислено 15, баланс 235';

  -- 5. Больше, чем есть, — нельзя.
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh, 'customer_id', cust, 'bonus_used', 236),
      jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 2)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 164)), null, emp);
    raise exception 'ТЕСТ 5: списали больше баланса';
  exception when others then
    if sqlerrm not like 'У клиента только%' then raise; end if;
  end;
  raise notice 'OK 5: больше баланса не списать';

  -- 6. Не больше доли чека из настроек.
  update pos_settings set bonus_max_percent = 50;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh, 'customer_id', cust, 'bonus_used', 201),
      jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 2)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 199)), null, emp);
    raise exception 'ТЕСТ 6: списали больше половины чека';
  exception when others then
    if sqlerrm not like 'Бонусами можно оплатить не больше 200%' then raise; end if;
  end;
  update pos_settings set bonus_max_percent = 100;
  raise notice 'OK 6: не больше доли чека из настроек';

  -- 7. «Тренировка»: не начисляет и не списывает.
  res := pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sht, 'customer_id', cust),
    jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 200)), null, emp);
  if (res->>'bonus_earned')::numeric <> 0 or (select bonus_balance from customers where id = cust) <> 235 then
    raise exception 'ТЕСТ 7: тренировочная продажа тронула бонусы';
  end if;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sht, 'customer_id', cust, 'bonus_used', 10),
      jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 190)), null, emp);
    raise exception 'ТЕСТ 7: списание в тренировке прошло';
  exception when others then
    if sqlerrm not like '%Тренировке%' then raise; end if;
  end;
  raise notice 'OK 7: в «Тренировке» бонусы не двигаются';

  -- 8. Повтор того же чека — без новых движений.
  select count(*) into n from customer_bonus_moves where customer_id = cust;
  res := pos_record_sale(jsonb_build_object('id', s2, 'shift_id', sh, 'customer_id', cust, 'bonus_used', 100),
    jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 2)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300)), null, emp);
  if not (res->>'repeated')::boolean then raise exception 'ТЕСТ 8: повтор не распознан'; end if;
  if (select count(*) from customer_bonus_moves where customer_id = cust) <> n then raise exception 'ТЕСТ 8: повтор добавил движения'; end if;
  raise notice 'OK 8: повтор чека бонусы не задвоил';

  -- 9. Заказ с предоплатой: +бонусы; отмена с возвратом денег — бонусы сгорают.
  pay := jsonb_build_object('sale_id', gen_random_uuid(), 'shift_id', sh,
                            'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000)));
  res := pos_create_order(
    jsonb_build_object('id', o1, 'delivery_date', current_date + 1, 'total', 2000, 'customer_id', cust, 'customer_phone', '+79990003301',
                       'recipient_name', 'Получатель', 'recipient_phone', '+79990003302', 'is_pickup', true),
    pay, loc, null, emp);
  select bonus_balance into bal from customers where id = cust;
  if bal <> 285 then raise exception 'ТЕСТ 9: после предоплаты баланс % вместо 285', bal; end if;
  perform pos_cancel_order(o1, 'cash', 'передумали', null, emp);
  select bonus_balance into bal from customers where id = cust;
  if bal <> 235 then raise exception 'ТЕСТ 9: после отмены баланс % вместо 235', bal; end if;
  if not exists (select 1 from customer_bonus_moves where customer_id = cust and kind = 'reverse' and delta = -50) then
    raise exception 'ТЕСТ 9: нет движения «отмена» на −50';
  end if;
  raise notice 'OK 9: предоплата +50, отмена с возвратом −50';

  -- 10. Журнал сходится с балансом.
  if (select coalesce(sum(delta), 0) from customer_bonus_moves where customer_id = cust) <> (select bonus_balance from customers where id = cust) then
    raise exception 'ТЕСТ 10: журнал не сходится с балансом';
  end if;
  if has_table_privilege('anon', 'customer_bonus_moves', 'select') or has_function_privilege('anon', 'bonus_move(uuid, numeric, text, uuid, uuid, uuid, text, boolean)', 'execute') then
    raise exception 'ТЕСТ 10: у anon есть доступ к бонусам';
  end if;
  raise notice 'OK 10: журнал сходится с балансом, anon закрыт';

  raise notice '033: все 10 проверок прошли';
end $$;

rollback;
