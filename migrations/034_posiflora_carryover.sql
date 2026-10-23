-- ================================================================
-- 034: перенос заказов из Posiflora в день запуска.
--
-- В Posiflora лежат будущие заказы, часть — с предоплатой (на 8 марта —
-- десятки). В день запуска их заводят в Учёт. Внести предоплату обычной
-- оплатой нельзя: деньги посчитались бы дважды — в кассе смены и в
-- выручке, хотя получены ещё в Posiflora. Завести без предоплаты тоже
-- нельзя: курьер увидит «не оплачено» и возьмёт сумму второй раз.
--
-- Поэтому служебный способ оплаты «posiflora» («Внесено в Posiflora»):
-- он закрывает долг по заказу (pos_order_paid его считает), но такой чек
-- помечен carried_over — отчёты (сводка, деньги, зарплата, смена) его не
-- считают, в наличные смены он не идёт (is_cash = false), бонусы за него
-- не начисляются: клиент получил их в Posiflora. В кассе и в «Настройках»
-- этот способ не показывается.
-- ================================================================

begin;

insert into pos_payment_methods (code, title, is_cash, sort, is_active)
values ('posiflora', 'Внесено в Posiflora', false, 95, true)
on conflict (code) do nothing;

alter table pos_sales add column if not exists carried_over boolean not null default false;

comment on column pos_sales.carried_over is
  'Предоплата, полученная ещё в Posiflora (перенос заказа). Закрывает долг по заказу, но не выручка этого дня.';

create or replace function pos_record_sale(
  p_sale jsonb, p_lines jsonb, p_payments jsonb, p_staff uuid, p_employee uuid)
returns jsonb
language plpgsql
as $$
declare
  v_id         uuid := nullif(p_sale->>'id', '')::uuid;
  v_shift      pos_shifts%rowtype;
  v_set        pos_settings%rowtype;
  v_no         text;
  v_doc        uuid;
  v_line       jsonb;
  v_comp       jsonb;
  v_items      jsonb := '[]'::jsonb;   -- что списать со склада: [{item_id, qty}]
  v_sub        numeric := 0;
  v_amount     numeric;
  v_list       numeric;
  v_qty        numeric;
  v_price      numeric;
  v_disc_pct   numeric := coalesce(nullif(p_sale->>'discount_percent', '')::numeric, 0);
  v_disc       numeric;
  v_total      numeric;
  v_paid       numeric := 0;
  v_approver   uuid := nullif(p_sale->>'approved_by', '')::uuid;
  v_b          pos_bouquets%rowtype;
  v_bid        uuid;
  v_item       inv_items%rowtype;
  v_order      pos_orders%rowtype;
  v_customer   uuid := nullif(p_sale->>'customer_id', '')::uuid;
  v_pay        jsonb;
  v_seen       uuid[] := '{}';
  v_orders     integer := 0;
  v_cnt        integer;
  v_bonus      numeric := round(coalesce(nullif(p_sale->>'bonus_used', '')::numeric, 0), 0);
  v_earn       numeric := 0;
  v_real       boolean;
  v_bal        numeric;
  v_max        numeric;
  v_carry      boolean := false;
  v_pay_old    integer;
  v_pay_new    integer;
  i            integer := 0;
  r            record;
begin
  if v_id is null then
    raise exception 'У продажи нет идентификатора';
  end if;
  if exists (select 1 from pos_sales where id = v_id) then
    return (select jsonb_build_object('id', id, 'sale_no', sale_no, 'repeated', true, 'bonus_used', bonus_used, 'bonus_earned', bonus_earned) from pos_sales where id = v_id);
  end if;

  select * into v_shift from pos_shifts where id = nullif(p_sale->>'shift_id', '')::uuid for update;
  if not found or v_shift.status <> 'open' then
    raise exception 'Смена не открыта — откройте смену, потом продавайте';
  end if;
  select * into v_set from pos_settings where id;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Чек пуст';
  end if;

  -- Проход 1: проверить строки, посчитать сумму и собрать, что списать.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    i := i + 1;
    case v_line->>'kind'
      when 'bouquet' then
        v_price := nullif(v_line->>'price', '')::numeric;
        if v_price is null or v_price < 0 then
          raise exception 'Букет %: укажите цену', i;
        end if;
        v_comp := coalesce(v_line->'items', '[]'::jsonb);
        if jsonb_typeof(v_comp) <> 'array' then
          raise exception 'Букет %: состав должен быть списком', i;
        end if;
        if jsonb_array_length(v_comp) = 0 and v_set.composition_required then
          raise exception 'Букет %: укажите состав — так настроено владельцем', i;
        end if;
        for r in select (e->>'item_id')::uuid as item_id, (e->>'qty')::numeric as qty from jsonb_array_elements(v_comp) e loop
          if r.qty is null or r.qty <= 0 then
            raise exception 'Букет %: количество должно быть больше нуля', i;
          end if;
          if not exists (select 1 from inv_items where id = r.item_id) then
            raise exception 'Букет %: позиции нет на складе', i;
          end if;
        end loop;
        v_items := v_items || v_comp;
        v_sub := v_sub + round(v_price, 2);

      when 'vitrine' then
        select * into v_b from pos_bouquets where id = nullif(v_line->>'bouquet_id', '')::uuid for update;
        if not found then
          raise exception 'Строка %: букет не найден', i;
        end if;
        if v_b.status <> 'vitrine' then
          raise exception 'Букет «%» уже продан или снят с витрины', v_b.title;
        end if;
        if v_b.location_id <> v_shift.location_id then
          raise exception 'Букет «%» с другой витрины', v_b.title;
        end if;
        if v_b.id = any(v_seen) then
          raise exception 'Букет «%» дважды в одном чеке', v_b.title;
        end if;
        v_seen := v_seen || v_b.id;
        v_sub := v_sub + v_b.price;

      when 'item' then
        select * into v_item from inv_items where id = nullif(v_line->>'item_id', '')::uuid;
        if not found then
          raise exception 'Строка %: позиции нет на складе', i;
        end if;
        v_qty := nullif(v_line->>'qty', '')::numeric;
        v_price := coalesce(nullif(v_line->>'price', '')::numeric, v_item.sale_price);
        if v_qty is null or v_qty <= 0 then
          raise exception 'Строка %: количество должно быть больше нуля', i;
        end if;
        if v_price is null or v_price < 0 then
          raise exception '«%»: у позиции нет цены — укажите её', v_item.title;
        end if;
        if v_item.is_tracked then
          v_items := v_items || jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'qty', v_qty));
        end if;
        v_sub := v_sub + round(v_qty * v_price, 2);

      when 'order' then
        -- Оплата заказа: предоплата, доплата или остаток. Заказ блокируем,
        -- чтобы две оплаты с двух планшетов не переплатили его вдвоём.
        select * into v_order from pos_orders where id = nullif(v_line->>'order_id', '')::uuid for update;
        if not found then
          raise exception 'Заказ не найден';
        end if;
        if v_order.status = 'cancelled' then
          raise exception 'Заказ % отменён — оплатить его нельзя', v_order.order_no;
        end if;
        if v_order.location_id <> v_shift.location_id then
          raise exception 'Заказ % из другого места', v_order.order_no;
        end if;
        v_amount := round(nullif(v_line->>'amount', '')::numeric, 2);
        if v_amount is null or v_amount <= 0 then
          raise exception 'Укажите сумму оплаты заказа';
        end if;
        if v_amount > v_order.total - pos_order_paid(v_order.id) then
          raise exception 'По заказу % осталось оплатить % ₽, а вносится % ₽',
            v_order.order_no, v_order.total - pos_order_paid(v_order.id), v_amount;
        end if;
        v_orders := v_orders + 1;
        v_customer := coalesce(v_customer, v_order.customer_id);
        v_sub := v_sub + v_amount;

      else
        raise exception 'Строка %: непонятный вид строки', i;
    end case;
  end loop;

  -- Оплата заказа — отдельным чеком и без скидки: скидку по заказу
  -- закладывают в его сумму, когда заказ оформляют.
  if v_orders > 0 and (v_orders <> jsonb_array_length(p_lines) or v_orders > 1) then
    raise exception 'Оплату заказа проводите отдельным чеком, по одному заказу';
  end if;
  if v_orders > 0 and v_disc_pct > 0 then
    raise exception 'Скидку по заказу закладывают в его сумму, а не в оплату';
  end if;

  -- Скидка. Сверх лимита — только с подтверждением того, кому можно.
  if v_disc_pct < 0 or v_disc_pct > 100 then
    raise exception 'Скидка должна быть от 0 до 100%%';
  end if;
  if v_disc_pct > v_set.discount_limit_percent then
    if v_approver is null or not exists (
      select 1 from hr_employees where id = v_approver and can_approve and is_active) then
      raise exception 'Скидка больше % %% — нужно подтверждение администратора', v_set.discount_limit_percent;
    end if;
  else
    v_approver := null;
  end if;
  v_disc := round(v_sub * v_disc_pct / 100, 0);

  -- Бонусы (033). Двигаются только в настоящем магазине и только у
  -- выбранного клиента: в «Тренировке» пробные продажи не должны трогать
  -- настоящие балансы. Списание — целыми рублями, не больше баланса и не
  -- больше доли чека из настроек; начисление — от того, что заплачено
  -- деньгами (после скидки и бонусов), с округлением вниз.
  select not is_training into v_real from inv_locations where id = v_shift.location_id;
  if v_bonus < 0 then
    raise exception 'Бонусов к списанию не может быть меньше нуля';
  end if;
  if v_bonus > 0 then
    if not v_set.bonuses_enabled then
      raise exception 'Бонусы пока ведёт Posiflora — спишите их там';
    end if;
    if not v_real then
      raise exception 'В «Тренировке» бонусы не списываются';
    end if;
    if v_customer is null then
      raise exception 'Чтобы оплатить бонусами, выберите клиента';
    end if;
    if v_orders > 0 then
      raise exception 'Бонусами оплачивают покупку в зале, а не заказ';
    end if;
    select bonus_balance into v_bal from customers where id = v_customer for update;
    if coalesce(v_bal, 0) < v_bonus then
      raise exception 'У клиента только % бонусов', coalesce(v_bal, 0);
    end if;
    v_max := floor((v_sub - v_disc) * v_set.bonus_max_percent / 100);
    if v_bonus > v_max then
      raise exception 'Бонусами можно оплатить не больше % ₽ — % %% чека', v_max, v_set.bonus_max_percent;
    end if;
  end if;

  v_total := v_sub - v_disc - v_bonus;

  if v_set.bonuses_enabled and v_real and v_customer is not null and v_set.bonus_percent > 0 then
    v_earn := floor(v_total * v_set.bonus_percent / 100);
  end if;

  -- Оплаты: сумма ровно к оплате. Сдача — дело экрана, в учёт идёт
  -- полученное за покупку, а не купюра, которую дали.
  if jsonb_typeof(coalesce(p_payments, '[]'::jsonb)) <> 'array' then
    raise exception 'Оплаты должны быть списком';
  end if;
  for v_pay in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    if not exists (select 1 from pos_payment_methods where code = v_pay->>'method' and is_active) then
      raise exception 'Способ оплаты «%» не настроен', coalesce(v_pay->>'method', '');
    end if;
    if nullif(v_pay->>'amount', '')::numeric is null or (v_pay->>'amount')::numeric <= 0 then
      raise exception 'Сумма оплаты должна быть больше нуля';
    end if;
    v_paid := v_paid + round((v_pay->>'amount')::numeric, 2);
  end loop;
  if v_paid <> v_total then
    raise exception 'Оплачено % ₽, а к оплате % ₽', v_paid, v_total;
  end if;

  -- Перенос заказа из Posiflora (034): предоплата, полученная ещё там,
  -- записывается способом «posiflora». Такой чек закрывает долг по заказу,
  -- но это не новые деньги: в выручку, наличные смены и бонусы он не идёт
  -- (pos_sales.carried_over). Только для оплаты заказа и только целиком
  -- этим способом — иначе новые деньги смешались бы с перенесёнными.
  select count(*) filter (where value->>'method' = 'posiflora'),
         count(*) filter (where value->>'method' <> 'posiflora')
    into v_pay_old, v_pay_new
    from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb));
  if v_pay_old > 0 then
    if v_pay_new > 0 then
      raise exception 'Внесённое в Posiflora проводите отдельно от новых денег';
    end if;
    if v_orders = 0 then
      raise exception '«Внесено в Posiflora» — только для заказа, перенесённого из Posiflora';
    end if;
    v_carry := true;
    v_earn := 0;
  end if;

  v_no := inv_next_doc_no('check');

  -- Документ склада — если есть что списывать. Услуги (is_tracked = false)
  -- по остаткам не ведутся, даже если их положили в состав букета.
  select count(*) into v_cnt
    from jsonb_array_elements(v_items) e
    join inv_items it on it.id = (e->>'item_id')::uuid
   where it.is_tracked;

  if v_cnt > 0 then
    insert into inv_documents (doc_type, location_id, created_by, employee_id, comment, device_id)
    values ('sale', v_shift.location_id, p_staff, p_employee, 'Чек ' || v_no, nullif(p_sale->>'device_id', ''))
    returning id into v_doc;

    i := 0;
    for r in
      select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::numeric) as qty
        from jsonb_array_elements(v_items) e
        join inv_items it on it.id = (e->>'item_id')::uuid
       where it.is_tracked
       group by 1
       order by 1
    loop
      i := i + 1;
      insert into inv_document_lines (document_id, item_id, qty, sort) values (v_doc, r.item_id, r.qty, i);
    end loop;

    perform inv_post_document(v_doc, p_staff);
  end if;

  insert into pos_sales
    (id, sale_no, location_id, shift_id, customer_id, employee_id, staff_id, subtotal, discount_percent,
     discount_amount, discount_approved_by, bonus_used, bonus_earned, total, inv_document_id, comment, device_id, carried_over)
  values
    (v_id, v_no, v_shift.location_id, v_shift.id, v_customer, p_employee, p_staff,
     v_sub, v_disc_pct, v_disc, v_approver, v_bonus, v_earn, v_total, v_doc,
     nullif(trim(coalesce(p_sale->>'comment', '')), ''), nullif(p_sale->>'device_id', ''), v_carry);

  -- Проход 2: строки чека и букеты.
  i := 0;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    i := i + 1;
    case v_line->>'kind'
      when 'bouquet' then
        v_comp := coalesce(v_line->'items', '[]'::jsonb);
        v_price := round((v_line->>'price')::numeric, 2);
        select coalesce(sum(it.sale_price * (e->>'qty')::numeric), 0),
               coalesce(sum(it.avg_cost * (e->>'qty')::numeric), 0)
          into v_list, v_amount
          from jsonb_array_elements(v_comp) e
          join inv_items it on it.id = (e->>'item_id')::uuid;

        insert into pos_bouquets
          (id, location_id, title, price, status, has_composition, assembled_by, assembled_staff, cost, sale_id,
           closed_at, closed_by, device_id)
        values
          (coalesce(nullif(v_line->>'id', '')::uuid, gen_random_uuid()), v_shift.location_id,
           coalesce(nullif(trim(coalesce(v_line->>'title', '')), ''), 'Букет'), v_price, 'sold',
           jsonb_array_length(v_comp) > 0, p_employee, p_staff, round(v_amount, 2), v_id,
           now(), p_employee, nullif(p_sale->>'device_id', ''))
        returning id into v_bid;

        insert into pos_bouquet_items (bouquet_id, item_id, qty)
        select v_bid, (e->>'item_id')::uuid, sum((e->>'qty')::numeric)
          from jsonb_array_elements(v_comp) e
         group by 2;

        insert into pos_sale_lines (sale_id, kind, title, qty, unit_price, list_price, amount, bouquet_id, sort)
        select v_id, 'bouquet', title, 1, v_price, case when has_composition then round(v_list, 2) end, v_price, v_bid, i
          from pos_bouquets where id = v_bid;

      when 'vitrine' then
        select * into v_b from pos_bouquets where id = (v_line->>'bouquet_id')::uuid;
        update pos_bouquets
           set status = 'sold', sale_id = v_id, closed_at = now(), closed_by = p_employee
         where id = v_b.id;
        insert into pos_sale_lines (sale_id, kind, title, qty, unit_price, list_price, amount, bouquet_id, sort)
        values (v_id, 'vitrine', v_b.title, 1, v_b.price, v_b.price, v_b.price, v_b.id, i);

      when 'item' then
        select * into v_item from inv_items where id = (v_line->>'item_id')::uuid;
        v_qty := (v_line->>'qty')::numeric;
        v_price := round(coalesce(nullif(v_line->>'price', '')::numeric, v_item.sale_price), 2);
        insert into pos_sale_lines (sale_id, kind, title, qty, unit_price, list_price, amount, item_id, sort)
        values (v_id, 'item', v_item.title, v_qty, v_price, v_item.sale_price, round(v_qty * v_price, 2), v_item.id, i);

      when 'order' then
        select * into v_order from pos_orders where id = (v_line->>'order_id')::uuid;
        v_amount := round((v_line->>'amount')::numeric, 2);
        insert into pos_sale_lines (sale_id, kind, title, qty, unit_price, list_price, amount, order_id, sort)
        values (v_id, 'order', 'Оплата заказа ' || v_order.order_no, 1, v_amount, null, v_amount, v_order.id, i);
    end case;
  end loop;

  insert into pos_payments (sale_id, method, amount)
  select v_id, value->>'method', round((value->>'amount')::numeric, 2)
    from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb));

  if v_bonus > 0 then
    perform bonus_move(v_customer, -v_bonus, 'spend', v_id, null, p_staff, 'Чек ' || v_no);
  end if;
  if v_earn > 0 then
    perform bonus_move(v_customer, v_earn, 'earn', v_id, null, p_staff, 'Чек ' || v_no);
  end if;

  return jsonb_build_object('id', v_id, 'sale_no', v_no, 'repeated', false, 'bonus_used', v_bonus, 'bonus_earned', v_earn);
end;
$$;

commit;
