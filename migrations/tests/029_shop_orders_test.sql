-- ================================================================
-- Проверка заказов магазина (миграция 029). Транзакция откатывается.
-- Всё — на отдельном тестовом месте со своей сменой.
-- ================================================================

\set ON_ERROR_STOP on

begin;

do $$
declare
  loc    uuid;
  emp    uuid;
  a      uuid;
  doc    uuid;
  sh     uuid;
  o1     uuid := 'c0000000-0000-4000-8000-000000000001';
  o2     uuid := 'c0000000-0000-4000-8000-000000000002';
  o3     uuid := 'c0000000-0000-4000-8000-000000000003';
  o4     uuid := 'c0000000-0000-4000-8000-000000000004';
  bq     uuid;
  res    jsonb;
  q      numeric;
  cash0  numeric;
begin
  insert into inv_locations (title) values ('ТЕСТ заказы') returning id into loc;
  insert into hr_employees (full_name, short_name) values ('ТЕСТ Таня', 'Таня') returning id into emp;
  insert into inv_items (title, sale_price) values ('ТЕСТ эустома', 200) returning id into a;
  insert into inv_documents (doc_type, location_id, payment_method) values ('receipt', loc, 'cash') returning id into doc;
  insert into inv_document_lines (document_id, item_id, qty, unit_cost, sort) values (doc, a, 20, 80, 1);
  perform inv_post_document(doc, null);
  sh := pos_open_shift(null, loc, 3000, null, emp);

  -- 1. Заказ с частичной предоплатой наличными — одной транзакцией.
  res := pos_create_order(
    jsonb_build_object('id', o1, 'delivery_date', current_date + 1, 'total', 4000, 'customer_phone', '+79780000001',
                       'recipient_name', 'Ольга', 'recipient_phone', '+79780000002', 'delivery_address', 'ул. Гоголя, 7',
                       'time_from', '15:00', 'time_to', '17:00', 'wishes', 'нежные тона'),
    jsonb_build_object('sale_id', gen_random_uuid(), 'shift_id', sh,
                       'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1500))),
    loc, null, emp);
  if res->>'order_no' not like 'ЗК-%' then raise exception 'ТЕСТ 1: номер заказа %', res->>'order_no'; end if;
  if pos_order_paid(o1) <> 1500 then raise exception 'ТЕСТ 1: оплачено % вместо 1500', pos_order_paid(o1); end if;
  if pos_shift_expected_cash(sh) <> 4500 then raise exception 'ТЕСТ 1: в кассе % вместо 4500', pos_shift_expected_cash(sh); end if;
  if (pos_create_order(jsonb_build_object('id', o1, 'delivery_date', current_date, 'total', 1), null, loc, null, emp)->>'repeated')::boolean is not true then
    raise exception 'ТЕСТ 1: повтор создания не распознан';
  end if;
  raise notice 'OK 1: заказ % с предоплатой 1500 наличными, касса 4500', res->>'order_no';

  -- 2. Проверки при оформлении.
  begin
    perform pos_create_order(jsonb_build_object('id', gen_random_uuid(), 'delivery_date', current_date, 'total', 1000,
      'customer_phone', '+7978', 'is_pickup', false), null, loc, null, emp);
    raise exception 'ТЕСТ 2: доставка без адреса прошла';
  exception when others then
    if sqlerrm like 'ТЕСТ 2%' then raise; end if;
  end;
  begin
    perform pos_create_order(jsonb_build_object('id', gen_random_uuid(), 'delivery_date', current_date, 'total', 1000, 'is_pickup', true),
      null, loc, null, emp);
    raise exception 'ТЕСТ 2: заказ без телефонов прошёл';
  exception when others then
    if sqlerrm like 'ТЕСТ 2%' then raise; end if;
  end;
  raise notice 'OK 2: без адреса и без телефона заказ не оформить';

  -- 3. Переплатить нельзя; оплата заказа — отдельным чеком и без скидки.
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'order', 'order_id', o1, 'amount', 3000)),
      jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 3000)), null, emp);
    raise exception 'ТЕСТ 3: переплата прошла';
  exception when others then
    if sqlerrm like 'ТЕСТ 3%' then raise; end if;
  end;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'order', 'order_id', o1, 'amount', 500),
                        jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 700)), null, emp);
    raise exception 'ТЕСТ 3: оплата заказа смешалась с товаром';
  exception when others then
    if sqlerrm like 'ТЕСТ 3%' then raise; end if;
  end;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh, 'discount_percent', 5),
      jsonb_build_array(jsonb_build_object('kind', 'order', 'order_id', o1, 'amount', 1000)),
      jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 950)), null, emp);
    raise exception 'ТЕСТ 3: скидка на оплату заказа прошла';
  exception when others then
    if sqlerrm like 'ТЕСТ 3%' then raise; end if;
  end;
  raise notice 'OK 3: переплата, смешанный чек и скидка на оплату заказа не проходят';

  -- 4. Сборка к заказу списывает цветы и ставит «собран».
  bq := pos_assemble_bouquet(jsonb_build_object('order_id', o1, 'price', 4000),
    jsonb_build_array(jsonb_build_object('item_id', a, 'qty', 9)), loc, null, emp);
  select qty into q from inv_stock where item_id = a and location_id = loc;
  if q <> 11 then raise exception 'ТЕСТ 4: эустомы % вместо 11', q; end if;
  if (select status from pos_orders where id = o1) <> 'ready' then raise exception 'ТЕСТ 4: заказ не собран'; end if;
  if (select status from pos_bouquets where id = bq) <> 'order' then raise exception 'ТЕСТ 4: букет не помечен как к заказу'; end if;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'vitrine', 'bouquet_id', bq)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 4000)), null, emp);
    raise exception 'ТЕСТ 4: букет к заказу продан как витрина';
  exception when others then
    if sqlerrm like 'ТЕСТ 4%' then raise; end if;
  end;
  raise notice 'OK 4: сборка к заказу списала 9 стеблей, заказ «собран», букет не продать с витрины';

  -- 5. Доплата картой, шаги: у курьера → доставлен; букет продан, склад не тронут.
  perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
    jsonb_build_array(jsonb_build_object('kind', 'order', 'order_id', o1, 'amount', 2500)),
    jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 2500)), null, emp);
  if pos_order_paid(o1) <> 4000 then raise exception 'ТЕСТ 5: оплачено % вместо 4000', pos_order_paid(o1); end if;
  begin
    perform pos_set_order_status(o1, 'new', null, emp);
    raise exception 'ТЕСТ 5: заказ откатился назад';
  exception when others then
    if sqlerrm like 'ТЕСТ 5%' then raise; end if;
  end;
  perform pos_set_order_status(o1, 'delivering', null, emp);
  perform pos_set_order_status(o1, 'completed', null, emp);
  if (select status from pos_bouquets where id = bq) <> 'sold' then raise exception 'ТЕСТ 5: букет не продан'; end if;
  select qty into q from inv_stock where item_id = a and location_id = loc;
  if q <> 11 then raise exception 'ТЕСТ 5: выдача заказа тронула склад'; end if;
  begin
    perform pos_update_order(o1, jsonb_build_object('total', 1));
    raise exception 'ТЕСТ 5: закрытый заказ изменился';
  exception when others then
    if sqlerrm like 'ТЕСТ 5%' then raise; end if;
  end;
  raise notice 'OK 5: доплата картой, доставлен, букет продан, закрытый заказ не правится';

  -- 6. Правка: сумма не ниже оплаченного; самовывоз выдаётся без курьера.
  perform pos_create_order(jsonb_build_object('id', o2, 'delivery_date', current_date, 'total', 2000, 'is_pickup', true,
      'customer_phone', '+79780000003'),
    jsonb_build_object('sale_id', gen_random_uuid(), 'shift_id', sh,
                       'payments', jsonb_build_array(jsonb_build_object('method', 'transfer', 'amount', 1000))),
    loc, null, emp);
  begin
    perform pos_update_order(o2, jsonb_build_object('total', 900));
    raise exception 'ТЕСТ 6: сумма стала меньше оплаченного';
  exception when others then
    if sqlerrm like 'ТЕСТ 6%' then raise; end if;
  end;
  perform pos_update_order(o2, jsonb_build_object('total', 2200, 'card_text', 'С юбилеем'));
  if (select total from pos_orders where id = o2) <> 2200 then raise exception 'ТЕСТ 6: сумма не изменилась'; end if;
  perform pos_set_order_status(o2, 'ready', null, emp);
  begin
    perform pos_set_order_status(o2, 'delivering', null, emp);
    raise exception 'ТЕСТ 6: самовывоз отдан курьеру';
  exception when others then
    if sqlerrm like 'ТЕСТ 6%' then raise; end if;
  end;
  raise notice 'OK 6: сумма не ниже оплаченного, самовывоз курьеру не отдать';

  -- 7. Отмена с возвратом наличными: изъятие в кассе, чек — возврат, букет — на витрину.
  perform pos_create_order(jsonb_build_object('id', o3, 'delivery_date', current_date, 'total', 3000, 'is_pickup', true,
      'customer_phone', '+79780000004'),
    jsonb_build_object('sale_id', gen_random_uuid(), 'shift_id', sh,
                       'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000))),
    loc, null, emp);
  bq := pos_assemble_bouquet(jsonb_build_object('order_id', o3, 'price', 3000),
    jsonb_build_array(jsonb_build_object('item_id', a, 'qty', 2)), loc, null, emp);
  cash0 := pos_shift_expected_cash(sh);
  begin
    perform pos_cancel_order(o3, null, 'передумали', null, emp);
    raise exception 'ТЕСТ 7: отмена с предоплатой без выбора возврата прошла';
  exception when others then
    if sqlerrm like 'ТЕСТ 7%' then raise; end if;
  end;
  res := pos_cancel_order(o3, 'cash', 'передумали', null, emp);
  if pos_shift_expected_cash(sh) <> cash0 - 1000 then
    raise exception 'ТЕСТ 7: в кассе % вместо %', pos_shift_expected_cash(sh), cash0 - 1000;
  end if;
  if pos_order_paid(o3) <> 0 then raise exception 'ТЕСТ 7: предоплата всё ещё числится'; end if;
  if (select status from pos_bouquets where id = bq) <> 'vitrine' then raise exception 'ТЕСТ 7: букет не переехал на витрину'; end if;
  if (res->>'refunded')::numeric <> 1000 then raise exception 'ТЕСТ 7: вернули %', res->>'refunded'; end if;
  raise notice 'OK 7: возврат наличными — касса −1000 ровно один раз, букет на витрине';

  -- 8. Отмена «оставить у студии» и «вернули картой».
  perform pos_cancel_order(o2, 'keep', 'не пришли', null, emp);
  if pos_order_paid(o2) <> 1000 then raise exception 'ТЕСТ 8: удержанная предоплата пропала из выручки'; end if;
  perform pos_create_order(jsonb_build_object('id', o4, 'delivery_date', current_date, 'total', 1500, 'is_pickup', true,
      'customer_phone', '+79780000005'),
    jsonb_build_object('sale_id', gen_random_uuid(), 'shift_id', sh,
                       'payments', jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 1500))),
    loc, null, emp);
  cash0 := pos_shift_expected_cash(sh);
  perform pos_cancel_order(o4, 'other', null, null, emp);
  if pos_shift_expected_cash(sh) <> cash0 then raise exception 'ТЕСТ 8: возврат картой тронул наличные'; end if;
  if pos_order_paid(o4) <> 0 then raise exception 'ТЕСТ 8: возврат картой не снял предоплату'; end if;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'order', 'order_id', o4, 'amount', 100)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 100)), null, emp);
    raise exception 'ТЕСТ 8: отменённый заказ оплачен';
  exception when others then
    if sqlerrm like 'ТЕСТ 8%' then raise; end if;
  end;
  raise notice 'OK 8: «оставить» сохраняет выручку, «картой» не трогает наличные, отменённый не оплатить';

  -- 9. Журнал склада и кэш сходятся.
  if exists (select 1 from inv_stock_check where location_id = loc) then raise exception 'ТЕСТ 9: кэш разошёлся с журналом'; end if;
  raise notice 'OK 9: остатки сходятся с журналом';
end;
$$;

rollback;
