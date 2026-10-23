-- ================================================================
-- 033: бонусы клиентов — в Учёте.
--
-- До сих пор бонусы вела Posiflora: сайт показывал её баланс, касса
-- Учёта бонусы не трогала. Владелец: «бонусы для начала 5%». Чтобы
-- касса начисляла и принимала их, источником правды должен стать Учёт —
-- и для кассы, и для сайта, иначе балансы разъедутся.
--
-- Устроено как склад: журнал движений (customer_bonus_moves) — правда,
-- customers.bonus_balance — его итог. Двигает баланс только bonus_move:
-- она запирает строку клиента, не пускает баланс ниже нуля и пишет
-- движение одной транзакцией.
--
-- Включение — один раз, bonus_enable: остатки (уже освежённые из
-- Posiflora) записываются движением «перенос», и с этой минуты бонусы
-- ведёт Учёт. До включения не меняется ничего: касса бонусы не трогает,
-- сайт показывает баланс Posiflora.
--
-- Правила (меняются в «Настройках»): начислять bonus_percent от
-- оплаченного деньгами; оплатить бонусами можно не больше
-- bonus_max_percent чека. Только в настоящем магазине — не в «Тренировке».
--
-- Безопасность — как в 024: RLS без политик, гранты сняты с anon и
-- authenticated, функции — только service_role.
-- ================================================================

begin;

alter table pos_settings add column if not exists bonus_max_percent numeric(5,2) not null default 100
  check (bonus_max_percent between 0 and 100);
alter table pos_settings add column if not exists bonuses_since timestamptz;

comment on column pos_settings.bonus_max_percent is 'Какую долю чека можно оплатить бонусами, %.';
comment on column pos_settings.bonuses_since is 'С какого момента бонусы ведёт Учёт (bonus_enable). Пусто — Posiflora.';

create table if not exists customer_bonus_moves (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references customers(id) on delete cascade,
  delta          numeric(12,2) not null check (delta <> 0),
  kind           text not null check (kind in ('earn', 'spend', 'reverse', 'return', 'manual', 'import')),
  sale_id        uuid references pos_sales(id) on delete set null,
  site_order_id  uuid references orders(id) on delete set null,
  staff_id       uuid references staff(id) on delete set null,
  comment        text,
  created_at     timestamptz not null default now()
);

create index if not exists customer_bonus_moves_customer on customer_bonus_moves (customer_id, created_at desc);
create index if not exists customer_bonus_moves_sale on customer_bonus_moves (sale_id) where sale_id is not null;
create index if not exists customer_bonus_moves_order on customer_bonus_moves (site_order_id) where site_order_id is not null;

comment on table customer_bonus_moves is
  'Журнал бонусов: начисления (+), списания (−), отмены. customers.bonus_balance — его итог, двигает только bonus_move.';

-- ----------------------------------------------------------------
-- Единственный способ сдвинуть баланс. p_clamp — для отмен: если
-- клиент уже потратил начисленное, снимаем сколько есть, а не падаем
-- (отмену заказа нельзя блокировать из-за бонусов). Возвращает, на
-- сколько на самом деле сдвинулся баланс.
-- ----------------------------------------------------------------
create or replace function bonus_move(
  p_customer uuid, p_delta numeric, p_kind text, p_sale uuid, p_site_order uuid, p_staff uuid,
  p_comment text default null, p_clamp boolean default false)
returns numeric
language plpgsql
as $$
declare
  v_bal    numeric;
  v_delta  numeric := round(coalesce(p_delta, 0), 2);
begin
  if v_delta = 0 then
    return 0;
  end if;
  select bonus_balance into v_bal from customers where id = p_customer for update;
  if not found then
    raise exception 'Клиент не найден';
  end if;
  v_bal := coalesce(v_bal, 0);
  if v_bal + v_delta < 0 then
    if not p_clamp then
      raise exception 'У клиента только % бонусов', v_bal;
    end if;
    v_delta := -v_bal;
    if v_delta = 0 then
      return 0;
    end if;
  end if;
  insert into customer_bonus_moves (customer_id, delta, kind, sale_id, site_order_id, staff_id, comment)
  values (p_customer, v_delta, p_kind, p_sale, p_site_order, p_staff, nullif(trim(coalesce(p_comment, '')), ''));
  update customers
     set bonus_balance = v_bal + v_delta, bonus_balance_synced_at = now(), updated_at = now()
   where id = p_customer;
  return v_delta;
end;
$$;

-- ----------------------------------------------------------------
-- Переход на бонусы Учёта — один раз. Остатки к этому моменту уже
-- освежены из Posiflora (это делает действие владельца); здесь они
-- записываются движением «перенос», чтобы журнал сходился с балансом.
-- ----------------------------------------------------------------
create or replace function bonus_enable(p_staff uuid)
returns integer
language plpgsql
as $$
declare
  v_set  pos_settings%rowtype;
  v_n    integer := 0;
  r      record;
begin
  select * into v_set from pos_settings where id for update;
  if v_set.bonuses_enabled then
    return 0;
  end if;
  for r in
    select c.id, c.bonus_balance from customers c
     where coalesce(c.bonus_balance, 0) <> 0
       and not exists (select 1 from customer_bonus_moves m where m.customer_id = c.id)
  loop
    insert into customer_bonus_moves (customer_id, delta, kind, staff_id, comment)
    values (r.id, r.bonus_balance, 'import', p_staff, 'Остаток при переходе на бонусы Учёта');
    v_n := v_n + 1;
  end loop;
  update pos_settings set bonuses_enabled = true, bonuses_since = now(), updated_at = now() where id;
  return v_n;
end;
$$;

alter table customer_bonus_moves enable row level security;
revoke all on customer_bonus_moves from anon, authenticated;
grant select, insert, update, delete on customer_bonus_moves to service_role;

revoke all on function bonus_move(uuid, numeric, text, uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function bonus_move(uuid, numeric, text, uuid, uuid, uuid, text, boolean) to service_role;
revoke all on function bonus_enable(uuid) from public, anon, authenticated;
grant execute on function bonus_enable(uuid) to service_role;

-- ----------------------------------------------------------------
-- Продажа и отмена заказа — те же, что в 029, плюс бонусы.
-- ----------------------------------------------------------------

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
     discount_amount, discount_approved_by, bonus_used, bonus_earned, total, inv_document_id, comment, device_id)
  values
    (v_id, v_no, v_shift.location_id, v_shift.id, v_customer, p_employee, p_staff,
     v_sub, v_disc_pct, v_disc, v_approver, v_bonus, v_earn, v_total, v_doc,
     nullif(trim(coalesce(p_sale->>'comment', '')), ''), nullif(p_sale->>'device_id', ''));

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

create or replace function pos_cancel_order(
  p_order uuid, p_refund text, p_reason text, p_staff uuid, p_employee uuid)
returns jsonb
language plpgsql
as $$
declare
  v_o       pos_orders%rowtype;
  v_paid    numeric;
  v_shift   uuid;
  v_reason  uuid;
  v_moved   integer;
  r         record;
begin
  select * into v_o from pos_orders where id = p_order for update;
  if not found then
    raise exception 'Заказ не найден';
  end if;
  if v_o.status in ('completed', 'cancelled') then
    raise exception 'Заказ % уже закрыт', v_o.order_no;
  end if;

  v_paid := pos_order_paid(p_order);
  if v_paid > 0 then
    if p_refund is null or p_refund not in ('cash', 'other', 'keep') then
      raise exception 'По заказу внесено % ₽ — выберите, как вернуть предоплату', v_paid;
    end if;
    if p_refund = 'cash' then
      select id into v_shift from pos_shifts where location_id = v_o.location_id and status = 'open';
      if v_shift is null then
        raise exception 'Чтобы вернуть наличными, откройте смену';
      end if;
      select id into v_reason from pos_cash_reasons where kind = 'refund' and direction = 'out' and is_active order by sort limit 1;
      if v_reason is null then
        raise exception 'Нет причины «Возврат клиенту» в справочнике кассы';
      end if;
      perform pos_cash_move(null, v_shift, v_reason, v_paid, p_staff, p_employee, null,
                            'Возврат предоплаты по заказу ' || v_o.order_no, null);
    end if;
    if p_refund in ('cash', 'other') then
      update pos_sales s set status = 'returned'
       where s.status = 'paid'
         and exists (select 1 from pos_sale_lines l where l.sale_id = s.id and l.order_id = p_order);
      -- Деньги вернули — бонусы, начисленные за эти оплаты, сгорают (033).
      -- Если клиент их уже потратил, снимаем сколько есть: отмену заказа
      -- нельзя блокировать из-за бонусов.
      for r in
        select m.customer_id, m.delta, m.sale_id
          from customer_bonus_moves m
         where m.kind = 'earn'
           and exists (select 1 from pos_sale_lines l where l.sale_id = m.sale_id and l.order_id = p_order)
           and not exists (select 1 from customer_bonus_moves x where x.kind = 'reverse' and x.sale_id = m.sale_id)
      loop
        perform bonus_move(r.customer_id, -r.delta, 'reverse', r.sale_id, null, p_staff, 'Отмена заказа ' || v_o.order_no, true);
      end loop;
    end if;
  end if;

  update pos_orders
     set status = 'cancelled', closed_at = now(), closed_by = p_employee,
         cancel_reason = nullif(trim(coalesce(p_reason, '')), ''),
         refund_method = case when v_paid > 0 then p_refund end
   where id = p_order;

  update pos_bouquets set status = 'vitrine', order_id = null
   where order_id = p_order and status = 'order';
  get diagnostics v_moved = row_count;

  return jsonb_build_object('refunded', case when v_paid > 0 and p_refund <> 'keep' then v_paid else 0 end,
                            'to_vitrine', v_moved);
end;
$$;

commit;
