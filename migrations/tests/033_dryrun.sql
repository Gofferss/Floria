-- Прогон 033_bonuses.sql вместе с тестом в одной транзакции, с откатом.
-- Проверяет миграцию на боевой базе до того, как её применить. Сгенерирован scratch-скриптом.
begin;
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


-- ================================================================
-- Проверка торгового зала (миграция 028). Транзакция откатывается:
-- в базе не остаётся ни смены, ни чека, ни букета.
--
-- Всё — на отдельном тестовом месте, чтобы не задеть ни «Тренировку»,
-- ни «Магазин»: в каждом месте может быть только одна открытая смена.
-- ================================================================



do $$
declare
  loc      uuid;
  emp      uuid;
  boss     uuid;
  a        uuid;   -- цветок, 10 шт по 100
  b        uuid;   -- зелень, 10 шт по 50
  toy      uuid;   -- игрушка без прихода — уйдёт в минус
  svc      uuid;   -- услуга, по остаткам не ведётся
  doc      uuid;
  sh       uuid;
  vb       uuid;
  vb2      uuid;
  vb3      uuid;
  sale     uuid := 'b0000000-0000-4000-8000-000000000001';
  sale2    uuid := 'b0000000-0000-4000-8000-000000000002';
  res      jsonb;
  n        integer;
  q        numeric;
  purchase uuid;
  salary   uuid;
begin
  -- Подготовка.
  insert into inv_locations (title) values ('ТЕСТ зал') returning id into loc;
  insert into hr_employees (full_name, short_name) values ('ТЕСТ Катя', 'Катя') returning id into emp;
  insert into hr_employees (full_name, short_name, position, can_approve) values ('ТЕСТ Инна', 'Инна', 'owner', true) returning id into boss;
  insert into inv_items (title, sale_price) values ('ТЕСТ хризантема', 300) returning id into a;
  insert into inv_items (title, sale_price) values ('ТЕСТ эвкалипт', 120) returning id into b;
  insert into inv_items (title, sale_price) values ('ТЕСТ зайчик', 990) returning id into toy;
  insert into inv_items (title, sale_price, is_tracked) values ('ТЕСТ упаковка работой', 200, false) returning id into svc;

  insert into inv_documents (doc_type, location_id, payment_method) values ('receipt', loc, 'cash') returning id into doc;
  insert into inv_document_lines (document_id, item_id, qty, unit_cost, sort) values (doc, a, 10, 100, 1), (doc, b, 10, 50, 2);
  perform inv_post_document(doc, null);

  if exists (select 1 from inv_groups where icon is null) then
    raise exception 'ТЕСТ 0: у группы не проставлен значок';
  end if;
  raise notice 'OK 0: значки групп проставлены';

  -- 1. Смена открывается одна.
  sh := pos_open_shift(null, loc, 5000, null, emp, 'ipad');
  if pos_shift_expected_cash(sh) <> 5000 then raise exception 'ТЕСТ 1: в кассе % вместо 5000', pos_shift_expected_cash(sh); end if;
  begin
    perform pos_open_shift(null, loc, 100, null, emp);
    raise exception 'ТЕСТ 1: открылась вторая смена';
  exception when others then
    if sqlerrm like 'ТЕСТ 1%' then raise; end if;
  end;
  if pos_open_shift(sh, loc, 5000, null, emp) <> sh then raise exception 'ТЕСТ 1: повтор открытия дал другую смену'; end if;
  raise notice 'OK 1: смена открыта, вторая не открывается, повтор безопасен';

  -- 2. Сборка на витрину списывает цветы и морозит себестоимость.
  vb := pos_assemble_bouquet(
    jsonb_build_object('title', 'ТЕСТ витринный', 'price', 2000),
    jsonb_build_array(jsonb_build_object('item_id', a, 'qty', 3), jsonb_build_object('item_id', b, 'qty', 2)),
    loc, null, emp);
  select qty into q from inv_stock where item_id = a and location_id = loc;
  if q <> 7 then raise exception 'ТЕСТ 2: хризантемы % вместо 7', q; end if;
  if (select cost from pos_bouquets where id = vb) <> 400 then
    raise exception 'ТЕСТ 2: себестоимость % вместо 400', (select cost from pos_bouquets where id = vb);
  end if;
  if (select status from pos_bouquets where id = vb) <> 'vitrine' then raise exception 'ТЕСТ 2: букет не на витрине'; end if;
  if (select count(*) from pos_bouquet_items where bouquet_id = vb) <> 2 then raise exception 'ТЕСТ 2: состав не записан'; end if;
  raise notice 'OK 2: сборка списала 3+2 стебля, себестоимость 400';

  -- 3. Продажа: витрина + позиция + букет из чека + букет по цене.
  res := pos_record_sale(
    jsonb_build_object('id', sale, 'shift_id', sh),
    jsonb_build_array(
      jsonb_build_object('kind', 'vitrine', 'bouquet_id', vb),
      jsonb_build_object('kind', 'item', 'item_id', toy, 'qty', 1, 'price', 990),
      jsonb_build_object('kind', 'bouquet', 'price', 1500,
        'items', jsonb_build_array(jsonb_build_object('item_id', a, 'qty', 2), jsonb_build_object('item_id', svc, 'qty', 1))),
      jsonb_build_object('kind', 'bouquet', 'title', 'Букет за 1000', 'price', 1000)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2000), jsonb_build_object('method', 'card', 'amount', 3490)),
    null, emp);
  if (res->>'repeated')::boolean then raise exception 'ТЕСТ 3: первая продажа помечена повтором'; end if;
  if (select subtotal from pos_sales where id = sale) <> 5490 then raise exception 'ТЕСТ 3: сумма чека неверна'; end if;
  select qty into q from inv_stock where item_id = a and location_id = loc;
  if q <> 5 then raise exception 'ТЕСТ 3: хризантемы % вместо 5', q; end if;
  select qty into q from inv_stock where item_id = toy and location_id = loc;
  if q <> -1 then raise exception 'ТЕСТ 3: зайчиков % вместо −1 (продажа в минус должна пройти)', q; end if;
  if exists (select 1 from inv_stock where item_id = svc) then raise exception 'ТЕСТ 3: услуга попала на склад'; end if;
  if (select status from pos_bouquets where id = vb) <> 'sold' then raise exception 'ТЕСТ 3: витринный букет не продан'; end if;
  if (select count(*) from pos_bouquets where sale_id = sale) <> 3 then raise exception 'ТЕСТ 3: букетов в чеке не 3'; end if;
  if (select count(*) from pos_bouquets where sale_id = sale and not has_composition) <> 1 then
    raise exception 'ТЕСТ 3: букет по цене не помечен «без состава»';
  end if;
  if (select doc_type from inv_documents d join pos_sales s on s.inv_document_id = d.id where s.id = sale) <> 'sale' then
    raise exception 'ТЕСТ 3: нет документа продажи';
  end if;
  if pos_shift_expected_cash(sh) <> 7000 then raise exception 'ТЕСТ 3: в кассе % вместо 7000', pos_shift_expected_cash(sh); end if;
  raise notice 'OK 3: продажа % записана, склад списан, наличные посчитаны', res->>'sale_no';

  -- 4. Повторная отправка той же продажи ничего не задваивает.
  res := pos_record_sale(jsonb_build_object('id', sale, 'shift_id', sh), '[{"kind":"item"}]'::jsonb, '[]'::jsonb, null, emp);
  if not (res->>'repeated')::boolean then raise exception 'ТЕСТ 4: повтор не распознан'; end if;
  if (select count(*) from pos_sales where id = sale) <> 1 then raise exception 'ТЕСТ 4: чек задвоился'; end if;
  raise notice 'OK 4: повтор продажи распознан';

  -- 5. Проданный букет второй раз не продать; один букет дважды в чек не положить.
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'vitrine', 'bouquet_id', vb)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2000)), null, emp);
    raise exception 'ТЕСТ 5: проданный букет продан снова';
  exception when others then
    if sqlerrm like 'ТЕСТ 5%' then raise; end if;
  end;
  vb2 := pos_assemble_bouquet(jsonb_build_object('title', 'ТЕСТ второй', 'price', 900),
    jsonb_build_array(jsonb_build_object('item_id', b, 'qty', 1)), loc, null, emp);
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'vitrine', 'bouquet_id', vb2), jsonb_build_object('kind', 'vitrine', 'bouquet_id', vb2)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1800)), null, emp);
    raise exception 'ТЕСТ 5: один букет прошёл дважды';
  exception when others then
    if sqlerrm like 'ТЕСТ 5%' then raise; end if;
  end;
  raise notice 'OK 5: проданный букет не продаётся снова, дубль в чеке не проходит';

  -- 6. Скидка сверх лимита — только с подтверждением; оплата обязана сойтись.
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh, 'discount_percent', 15),
      jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 255)), null, emp);
    raise exception 'ТЕСТ 6: скидка 15%% прошла без подтверждения';
  exception when others then
    if sqlerrm like 'ТЕСТ 6%' then raise; end if;
  end;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh, 'discount_percent', 15, 'approved_by', emp),
      jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 255)), null, emp);
    raise exception 'ТЕСТ 6: подтвердил тот, кому нельзя';
  exception when others then
    if sqlerrm like 'ТЕСТ 6%' then raise; end if;
  end;
  res := pos_record_sale(jsonb_build_object('id', sale2, 'shift_id', sh, 'discount_percent', 15, 'approved_by', boss),
    jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('method', 'sbp', 'amount', 255)), null, emp);
  if (select discount_amount from pos_sales where id = sale2) <> 45 or (select discount_approved_by from pos_sales where id = sale2) <> boss then
    raise exception 'ТЕСТ 6: скидка записана неверно';
  end if;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 200)), null, emp);
    raise exception 'ТЕСТ 6: оплата меньше суммы прошла';
  exception when others then
    if sqlerrm like 'ТЕСТ 6%' then raise; end if;
  end;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh, 'bonus_used', 100),
      jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300)), null, emp);
    raise exception 'ТЕСТ 6: бонусы списались, хотя их ведёт Posiflora';
  exception when others then
    if sqlerrm like 'ТЕСТ 6%' then raise; end if;
  end;
  raise notice 'OK 6: скидка с подтверждением, оплата сходится, бонусы не трогаются';

  -- 7. Состав обязателен, если так настроил владелец.
  update pos_settings set composition_required = true where id;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'bouquet', 'price', 1000)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000)), null, emp);
    raise exception 'ТЕСТ 7: букет без состава прошёл при обязательном составе';
  exception when others then
    if sqlerrm like 'ТЕСТ 7%' then raise; end if;
  end;
  update pos_settings set composition_required = false where id;
  raise notice 'OK 7: настройка «состав обязателен» работает';

  -- 8. Разборка возвращает цветы по цене сборки, списание букета склад не трогает.
  select qty into q from inv_stock where item_id = b and location_id = loc;
  perform pos_disassemble_bouquet(vb2, null, emp);
  if (select qty from inv_stock where item_id = b and location_id = loc) <> q + 1 then raise exception 'ТЕСТ 8: эвкалипт не вернулся'; end if;
  if (select avg_cost from inv_items where id = b) <> 50 then
    raise exception 'ТЕСТ 8: средняя эвкалипта сдвинулась: %', (select avg_cost from inv_items where id = b);
  end if;
  if (select status from pos_bouquets where id = vb2) <> 'disassembled' then raise exception 'ТЕСТ 8: букет не разобран'; end if;
  vb3 := pos_assemble_bouquet(jsonb_build_object('title', 'ТЕСТ завянет', 'price', 700),
    jsonb_build_array(jsonb_build_object('item_id', b, 'qty', 1)), loc, null, emp);
  select qty into q from inv_stock where item_id = b and location_id = loc;
  perform pos_writeoff_bouquet(vb3, null, emp, null);
  if (select qty from inv_stock where item_id = b and location_id = loc) <> q then raise exception 'ТЕСТ 8: списание букета тронуло склад'; end if;
  if (select writeoff_reason from pos_bouquets where id = vb3) <> 'Завял' then raise exception 'ТЕСТ 8: причина не записана'; end if;
  raise notice 'OK 8: разборка вернула цветы по цене сборки, списание букета без движения склада';

  -- 9. Документы кассы не сторнируются в обход неё.
  begin
    perform inv_reverse_document((select inv_document_id from pos_sales where id = sale), null, null);
    raise exception 'ТЕСТ 9: документ продажи сторнирован в обход возврата';
  exception when others then
    if sqlerrm like 'ТЕСТ 9%' then raise; end if;
  end;
  begin
    perform inv_reverse_document((select assembly_doc_id from pos_bouquets where id = vb3), null, null);
    raise exception 'ТЕСТ 9: документ сборки сторнирован';
  exception when others then
    if sqlerrm like 'ТЕСТ 9%' then raise; end if;
  end;
  raise notice 'OK 9: документы кассы не сторнируются напрямую';

  -- 10. Чек, его строки и проданный букет не правятся.
  begin
    update pos_sales set total = 1 where id = sale;
    raise exception 'ТЕСТ 10: сумма чека изменилась';
  exception when others then
    if sqlerrm like 'ТЕСТ 10%' then raise; end if;
  end;
  begin
    delete from pos_sales where id = sale;
    raise exception 'ТЕСТ 10: чек удалён';
  exception when others then
    if sqlerrm like 'ТЕСТ 10%' then raise; end if;
  end;
  begin
    update pos_bouquets set price = 1 where id = vb;
    raise exception 'ТЕСТ 10: цена проданного букета изменилась';
  exception when others then
    if sqlerrm like 'ТЕСТ 10%' then raise; end if;
  end;
  update pos_bouquets set photo_urls = array['https://example.test/1.jpg'] where id = vb;
  update pos_sales set comment = 'ТЕСТ комментарий' where id = sale;
  raise notice 'OK 10: чек и проданный букет не правятся, фото и комментарий — можно';

  -- 11. Движения наличных.
  select id into purchase from pos_cash_reasons where kind = 'purchase' limit 1;
  select id into salary from pos_cash_reasons where kind = 'salary' limit 1;
  perform pos_cash_move(null, sh, purchase, 500, null, emp, null, 'эустома');
  if pos_shift_expected_cash(sh) <> 6500 then raise exception 'ТЕСТ 11: в кассе % вместо 6500', pos_shift_expected_cash(sh); end if;
  begin
    perform pos_cash_move(null, sh, salary, 100, null, emp, null, null);
    raise exception 'ТЕСТ 11: зарплата без человека';
  exception when others then
    if sqlerrm like 'ТЕСТ 11%' then raise; end if;
  end;
  begin
    perform pos_cash_move(null, sh, purchase, 100000, null, emp, null, null);
    raise exception 'ТЕСТ 11: изъяли больше, чем есть';
  exception when others then
    if sqlerrm like 'ТЕСТ 11%' then raise; end if;
  end;
  begin
    delete from pos_cash_movements where shift_id = sh;
    raise exception 'ТЕСТ 11: движение наличных удалено';
  exception when others then
    if sqlerrm like 'ТЕСТ 11%' then raise; end if;
  end;
  raise notice 'OK 11: изъятие учтено, зарплата без человека и лишнее изъятие не проходят';

  -- 12. Закрытие считает расхождение; без смены не продать.
  res := pos_close_shift(sh, 6400, null, emp, null);
  if (res->>'expected')::numeric <> 6500 or (res->>'diff')::numeric <> -100 then
    raise exception 'ТЕСТ 12: закрытие посчитало %', res;
  end if;
  begin
    perform pos_record_sale(jsonb_build_object('id', gen_random_uuid(), 'shift_id', sh),
      jsonb_build_array(jsonb_build_object('kind', 'item', 'item_id', a, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300)), null, emp);
    raise exception 'ТЕСТ 12: продажа в закрытую смену';
  exception when others then
    if sqlerrm like 'ТЕСТ 12%' then raise; end if;
  end;
  sh := pos_open_shift(null, loc, 6400, null, emp);
  if (select previous_counted_cash from pos_shifts where id = sh) <> 6400 then raise exception 'ТЕСТ 12: новая смена не видит прошлое закрытие'; end if;
  raise notice 'OK 12: закрытие с расхождением −100, новая смена видит прошлый пересчёт';

  -- 13. Кэш остатков сходится с журналом.
  select count(*) into n from inv_stock_check where location_id = loc;
  if n <> 0 then raise exception 'ТЕСТ 13: кэш остатков разошёлся с журналом в % строках', n; end if;
  raise notice 'OK 13: остатки сходятся с журналом';
end;
$$;


-- ================================================================
-- Проверка заказов магазина (миграция 029). Транзакция откатывается.
-- Всё — на отдельном тестовом месте со своей сменой.
-- ================================================================



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


-- ================================================================
-- Проверка бонусов (миграция 033). Транзакция откатывается — настройки
-- и балансы настоящих клиентов не меняются.
-- ================================================================



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
