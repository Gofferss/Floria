-- ================================================================
-- Проверка переноса заказов из Posiflora (миграция 034). Откатывается.
-- ================================================================

\set ON_ERROR_STOP on

begin;

do $$
declare
  loc    uuid;
  emp    uuid;
  a      uuid;
  sh     uuid;
  cust   uuid;
  o1     uuid := 'e0000000-0000-4000-8000-000000000001';
  res    jsonb;
  cash0  numeric;
  bal0   numeric;
begin
  insert into inv_locations (title) values ('ТЕСТ перенос') returning id into loc;
  insert into hr_employees (full_name, short_name) values ('ТЕСТ Перенос', 'Перенос') returning id into emp;
  insert into inv_items (title, sale_price) values ('ТЕСТ тюльпан', 100) returning id into a;
  sh := pos_open_shift(null, loc, 2000, null, emp);
  insert into customers (phone, full_name, bonus_balance) values ('+79990003401', 'ТЕСТ Перенос', 0) returning id into cust;
  update pos_settings set bonuses_enabled = true, bonus_percent = 5, bonus_max_percent = 100;
  cash0 := pos_shift_expected_cash(sh);

  -- 1. Заказ с предоплатой «внесено в Posiflora»: долг закрыт, касса и бонусы не тронуты.
  res := pos_create_order(
    jsonb_build_object('id', o1, 'delivery_date', current_date + 10, 'total', 5000, 'customer_id', cust, 'customer_phone', '+79990003401',
                       'recipient_name', 'Получатель', 'recipient_phone', '+79990003402', 'is_pickup', true),
    jsonb_build_object('sale_id', gen_random_uuid(), 'shift_id', sh,
                       'payments', jsonb_build_array(jsonb_build_object('method', 'posiflora', 'amount', 2000))),
    loc, null, emp);
  if pos_order_paid(o1) <> 2000 then raise exception 'ТЕСТ 1: по заказу оплачено % вместо 2000', pos_order_paid(o1); end if;
  if pos_shift_expected_cash(sh) <> cash0 then raise exception 'ТЕСТ 1: перенос изменил наличные смены'; end if;
  if not exists (select 1 from pos_sales s join pos_sale_lines l on l.sale_id = s.id where l.order_id = o1 and s.carried_over) then
    raise exception 'ТЕСТ 1: чек переноса не помечен carried_over';
  end if;
  select bonus_balance into bal0 from customers where id = cust;
  if bal0 <> 0 then raise exception 'ТЕСТ 1: за перенос начислены бонусы (%)', bal0; end if;
  raise notice 'OK 1: долг по заказу закрыт на 2000, наличные и бонусы не тронуты';

  -- 2. Доплата новыми деньгами — обычный чек: выручка, наличные, бонусы.
  res := pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
    jsonb_build_array(jsonb_build_object('kind', 'order', 'order_id', o1, 'amount', 3000)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 3000)), null, emp);
  if pos_order_paid(o1) <> 5000 then raise exception 'ТЕСТ 2: заказ оплачен на % вместо 5000', pos_order_paid(o1); end if;
  if pos_shift_expected_cash(sh) <> cash0 + 3000 then raise exception 'ТЕСТ 2: доплата не попала в наличные'; end if;
  if (select bonus_balance from customers where id = cust) <> 150 then raise exception 'ТЕСТ 2: за доплату не начислено 150'; end if;
  raise notice 'OK 2: доплата 3000 — в наличных и с бонусами 150';

  -- 3. «Внесено в Posiflora» вместе с новыми деньгами — нельзя.
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'order', 'order_id',
        (pos_create_order(jsonb_build_object('id', gen_random_uuid(), 'delivery_date', current_date + 5, 'total', 1000, 'customer_phone', '+79990003403', 'is_pickup', true), null, loc, null, emp)->>'id')::uuid,
        'amount', 1000)),
      jsonb_build_array(jsonb_build_object('method', 'posiflora', 'amount', 500), jsonb_build_object('method', 'cash', 'amount', 500)), null, emp);
    raise exception 'ТЕСТ 3: смешанная оплата прошла';
  exception when others then
    if sqlerrm not like 'Внесённое в Posiflora%' then raise; end if;
  end;
  raise notice 'OK 3: перенос не смешивается с новыми деньгами';

  -- 4. «Внесено в Posiflora» в продаже зала — нельзя.
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('method', 'posiflora', 'amount', 100)), null, emp);
    raise exception 'ТЕСТ 4: перенос в продаже зала прошёл';
  exception when others then
    if sqlerrm not like '%только для заказа%' then raise; end if;
  end;
  raise notice 'OK 4: в продаже зала способ «внесено в Posiflora» не принимается';

  raise notice '034: все 4 проверки прошли';
end $$;

rollback;
