-- ================================================================
-- Флория Учёт: заказы магазина на дату.
--
-- Заказ из зала, по телефону или из мессенджера: дата и время, доставка
-- или самовывоз, получатель, открытка, «что собрать», сумма. Платят
-- по-разному — всё заранее, часть или при получении, любым способом, —
-- поэтому оплата — это не флаг, а продажи: каждая предоплата, доплата и
-- остаток — отдельный чек в смене (строка вида 'order'). Наличные сразу
-- попадают в расчёт кассы, у заказа видно «оплачено N из M».
--
-- Цветы списываются, когда букет к заказу собран (pos_assemble_bouquet с
-- order_id), как у витрины. Отдельная таблица, а не orders сайта:
-- владелец решил, что заказы магазина не пишут клиентам в бот, а у
-- orders к этому привязаны напоминания, отзывы и уведомления студии.
--
-- Отмена с предоплатой: вернуть наличными (изъятие из кассы), вернуть
-- картой или переводом (вне кассы) или оставить у студии. В первых двух
-- случаях чеки предоплаты помечаются возвратом — из выручки они уходят.
--
-- Сколько наличных в кассе теперь считается по всем чекам смены, включая
-- возвращённые: деньги за них физически приходили, а возврат наличными —
-- отдельное изъятие. Иначе возврат вычитался бы дважды.
-- ================================================================

begin;

-- ---------------------------------------------------------------
-- Номера и причины
-- ---------------------------------------------------------------

create or replace function inv_next_doc_no(p_type text)
returns text
language plpgsql
as $$
declare
  n integer;
  prefix text := case p_type
    when 'opening'     then 'НО'
    when 'receipt'     then 'ПР'
    when 'writeoff'    then 'СП'
    when 'inventory'   then 'ИН'
    when 'assembly'    then 'СБ'
    when 'disassembly' then 'РЗ'
    when 'sale'        then 'ПД'
    when 'return'      then 'ВЗ'
    when 'check'       then 'ЧК'
    when 'order'       then 'ЗК'
    else 'ДК'
  end;
begin
  insert into inv_doc_counters (doc_type, last_no) values (p_type, 1)
  on conflict (doc_type) do update set last_no = inv_doc_counters.last_no + 1
  returning last_no into n;
  return prefix || '-' || lpad(n::text, 4, '0');
end;
$$;

alter table pos_cash_reasons drop constraint if exists pos_cash_reasons_kind_check;
alter table pos_cash_reasons add constraint pos_cash_reasons_kind_check
  check (kind in ('purchase', 'salary', 'collection', 'refund', 'other'));

insert into pos_cash_reasons (direction, title, kind, sort)
values ('out', 'Возврат клиенту', 'refund', 60)
on conflict (direction, title) do nothing;

-- ---------------------------------------------------------------
-- Заказы
-- ---------------------------------------------------------------

create table if not exists pos_orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         text not null unique,
  location_id      uuid not null references inv_locations(id),
  status           text not null default 'new'
                   check (status in ('new', 'assembling', 'ready', 'delivering', 'completed', 'cancelled')),
  -- Откуда пришёл: зал, звонок, мессенджер. Для отчёта «откуда заказы».
  channel          text not null default 'shop' check (channel in ('shop', 'phone', 'messenger', 'other')),
  customer_id      uuid references customers(id) on delete set null,
  customer_name    text,
  customer_phone   text,
  recipient_name   text,
  recipient_phone  text,
  is_pickup        boolean not null default false,
  delivery_address text,
  delivery_details text,
  delivery_date    date not null,
  time_from        time,
  time_to          time,
  card_text        text,
  -- Что собрать: «в бюджет 3 500, нежные тона, без лилий».
  wishes           text,
  courier_comment  text,
  total            numeric(12,2) not null check (total >= 0),
  created_by       uuid references hr_employees(id) on delete set null,
  created_staff    uuid references staff(id) on delete set null,
  closed_at        timestamptz,
  closed_by        uuid references hr_employees(id) on delete set null,
  cancel_reason    text,
  refund_method    text check (refund_method in ('cash', 'other', 'keep')),
  device_id        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table pos_orders is 'Заказы магазина на дату. Оплаты — чеки со строкой вида order; клиентам в бот не пишут.';

create index if not exists pos_orders_date on pos_orders (location_id, delivery_date, status);

drop trigger if exists pos_orders_updated on pos_orders;
create trigger pos_orders_updated before update on pos_orders
  for each row execute function set_updated_at();

-- Закрытый заказ (доставлен или отменён) не правится, кроме комментария
-- курьеру и пожеланий — на память. Номер и место не меняются никогда.
create or replace function pos_orders_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Заказ не удаляется — его отменяют';
  end if;
  if new.order_no is distinct from old.order_no or new.location_id is distinct from old.location_id then
    raise exception 'Номер и место заказа не меняются';
  end if;
  if old.status in ('completed', 'cancelled') then
    if row(new.status, new.total, new.delivery_date, new.is_pickup, new.customer_id, new.refund_method)
       is distinct from row(old.status, old.total, old.delivery_date, old.is_pickup, old.customer_id, old.refund_method) then
      raise exception 'Заказ % закрыт — менять его нельзя', old.order_no;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pos_orders_guard on pos_orders;
create trigger pos_orders_guard before update or delete on pos_orders
  for each row execute function pos_orders_guard();

-- ---------------------------------------------------------------
-- Связи с букетами и чеками
-- ---------------------------------------------------------------

alter table pos_bouquets add column if not exists order_id uuid references pos_orders(id);
alter table pos_bouquets drop constraint if exists pos_bouquets_status_check;
alter table pos_bouquets add constraint pos_bouquets_status_check
  check (status in ('vitrine', 'order', 'sold', 'disassembled', 'written_off'));

create index if not exists pos_bouquets_order on pos_bouquets (order_id) where order_id is not null;

-- Букет к заказу ведёт себя как букет витрины: пока его не отдали, можно
-- менять фото, цену, название; состав и себестоимость — нет.
create or replace function pos_bouquets_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Букет не удаляется — его продают, разбирают или списывают';
  end if;
  if old.status in ('vitrine', 'order') then
    if new.assembly_doc_id is distinct from old.assembly_doc_id
       or new.location_id is distinct from old.location_id
       or new.cost is distinct from old.cost then
      raise exception 'Состав и себестоимость собранного букета не правятся — разберите и соберите заново';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.price is distinct from old.price
     or new.title is distinct from old.title
     or new.sale_id is distinct from old.sale_id
     or new.order_id is distinct from old.order_id
     or new.cost is distinct from old.cost then
    raise exception 'Букет уже отдан — менять можно только фото и комментарий';
  end if;
  return new;
end;
$$;

alter table pos_sale_lines add column if not exists order_id uuid references pos_orders(id);
alter table pos_sale_lines drop constraint if exists pos_sale_lines_kind_check;
alter table pos_sale_lines add constraint pos_sale_lines_kind_check
  check (kind in ('bouquet', 'vitrine', 'item', 'order'));

create index if not exists pos_sale_lines_order on pos_sale_lines (order_id) where order_id is not null;

-- ---------------------------------------------------------------
-- Наличные в кассе — по всем чекам смены
-- ---------------------------------------------------------------

create or replace function pos_shift_expected_cash(p_shift uuid)
returns numeric
language sql
stable
as $$
  select s.opening_cash
       + coalesce((
           select sum(p.amount)
             from pos_payments p
             join pos_sales x on x.id = p.sale_id
             join pos_payment_methods m on m.code = p.method
            where x.shift_id = s.id and m.is_cash), 0)
       + coalesce((
           select sum(case when c.direction = 'in' then c.amount else -c.amount end)
             from pos_cash_movements c
            where c.shift_id = s.id), 0)
    from pos_shifts s
   where s.id = p_shift;
$$;

-- Сколько по заказу уже заплачено — по чекам, которые не вернули.
create or replace function pos_order_paid(p_order uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(l.amount), 0)
    from pos_sale_lines l
    join pos_sales s on s.id = l.sale_id
   where l.order_id = p_order and s.status = 'paid';
$$;

-- ---------------------------------------------------------------
-- Продажа: плюс строка «оплата заказа»
-- ---------------------------------------------------------------

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
  i            integer := 0;
  r            record;
begin
  if v_id is null then
    raise exception 'У продажи нет идентификатора';
  end if;
  if exists (select 1 from pos_sales where id = v_id) then
    return (select jsonb_build_object('id', id, 'sale_no', sale_no, 'repeated', true) from pos_sales where id = v_id);
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

  if coalesce(nullif(p_sale->>'bonus_used', '')::numeric, 0) > 0 and not v_set.bonuses_enabled then
    raise exception 'Бонусы пока ведёт Posiflora — спишите их там';
  end if;

  v_total := v_sub - v_disc;

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
     discount_amount, discount_approved_by, total, inv_document_id, comment, device_id)
  values
    (v_id, v_no, v_shift.location_id, v_shift.id, v_customer, p_employee, p_staff,
     v_sub, v_disc_pct, v_disc, v_approver, v_total, v_doc,
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

  return jsonb_build_object('id', v_id, 'sale_no', v_no, 'repeated', false);
end;
$$;

-- ---------------------------------------------------------------
-- Сборка: на витрину или к заказу
-- ---------------------------------------------------------------

create or replace function pos_assemble_bouquet(
  p_bouquet jsonb, p_items jsonb, p_location uuid, p_staff uuid, p_employee uuid)
returns uuid
language plpgsql
as $$
declare
  v_id     uuid := nullif(p_bouquet->>'id', '')::uuid;
  v_title  text := nullif(trim(coalesce(p_bouquet->>'title', '')), '');
  v_price  numeric := nullif(p_bouquet->>'price', '')::numeric;
  v_order  pos_orders%rowtype;
  v_for    uuid := nullif(p_bouquet->>'order_id', '')::uuid;
  v_doc    uuid;
  v_cost   numeric;
  r        record;
  i        integer := 0;
begin
  if v_id is not null and exists (select 1 from pos_bouquets where id = v_id) then
    return v_id;
  end if;
  if v_price is null or v_price < 0 then
    raise exception 'Укажите цену букета';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Добавьте в букет цветы — без состава собрать нельзя';
  end if;

  if v_for is not null then
    select * into v_order from pos_orders where id = v_for for update;
    if not found then
      raise exception 'Заказ не найден';
    end if;
    if v_order.status not in ('new', 'assembling', 'ready') then
      raise exception 'Заказ % уже % — собирать к нему поздно', v_order.order_no,
        case v_order.status when 'delivering' then 'у курьера' when 'completed' then 'выдан' else 'отменён' end;
    end if;
    if v_order.location_id <> p_location then
      raise exception 'Заказ % из другого места', v_order.order_no;
    end if;
  end if;

  insert into inv_documents (doc_type, location_id, created_by, employee_id, comment, device_id)
  values ('assembly', p_location, p_staff, p_employee,
          case when v_for is null then 'Букет на витрину: ' || coalesce(v_title, 'без названия')
               else 'Букет к заказу ' || v_order.order_no end,
          nullif(p_bouquet->>'device_id', ''))
  returning id into v_doc;

  for r in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(p_items) e
     group by 1
  loop
    i := i + 1;
    if r.qty is null or r.qty <= 0 then
      raise exception 'Строка %: количество должно быть больше нуля', i;
    end if;
    if not exists (select 1 from inv_items where id = r.item_id and is_tracked) then
      raise exception 'Строка %: такой позиции на складе нет', i;
    end if;
    insert into inv_document_lines (document_id, item_id, qty, sort) values (v_doc, r.item_id, r.qty, i);
  end loop;

  perform inv_post_document(v_doc, p_staff);
  select -coalesce(sum(amount), 0) into v_cost from inv_document_lines where document_id = v_doc;

  insert into pos_bouquets
    (id, location_id, title, price, status, has_composition, photo_urls, assembled_by, assembled_staff,
     assembly_doc_id, cost, order_id, comment, device_id)
  values
    (coalesce(v_id, gen_random_uuid()), p_location,
     coalesce(v_title, case when v_for is null then 'Букет' else 'Букет к заказу ' || v_order.order_no end),
     round(v_price, 2), case when v_for is null then 'vitrine' else 'order' end, true,
     coalesce(array(select jsonb_array_elements_text(coalesce(p_bouquet->'photo_urls', '[]'::jsonb))), '{}'),
     p_employee, p_staff, v_doc, v_cost, v_for,
     nullif(trim(coalesce(p_bouquet->>'comment', '')), ''), nullif(p_bouquet->>'device_id', ''))
  returning id into v_id;

  insert into pos_bouquet_items (bouquet_id, item_id, qty)
  select v_id, item_id, qty_delta * -1 from inv_document_lines where document_id = v_doc;

  -- Собрали к заказу — заказ собран. Ещё один букет к нему можно
  -- добавить, статус от этого не откатится.
  if v_for is not null then
    update pos_orders set status = 'ready' where id = v_for and status in ('new', 'assembling');
  end if;

  return v_id;
end;
$$;

-- Разобрать и списать можно и букет к заказу — например, собрали не то.
create or replace function pos_disassemble_bouquet(p_bouquet uuid, p_staff uuid, p_employee uuid)
returns void
language plpgsql
as $$
declare
  v_b    pos_bouquets%rowtype;
  v_doc  uuid;
begin
  select * into v_b from pos_bouquets where id = p_bouquet for update;
  if not found then
    raise exception 'Букет не найден';
  end if;
  if v_b.status not in ('vitrine', 'order') then
    raise exception 'Букет уже отдан';
  end if;

  if v_b.assembly_doc_id is not null then
    insert into inv_documents (doc_type, location_id, created_by, employee_id, comment)
    values ('disassembly', v_b.location_id, p_staff, p_employee, 'Разобран букет: ' || v_b.title)
    returning id into v_doc;

    insert into inv_document_lines (document_id, item_id, qty, unit_cost, sort)
    select v_doc, item_id, -qty_delta, unit_cost, sort
      from inv_document_lines
     where document_id = v_b.assembly_doc_id;

    perform inv_post_document(v_doc, p_staff);
  end if;

  update pos_bouquets
     set status = 'disassembled', closed_at = now(), closed_by = p_employee
   where id = p_bouquet;
end;
$$;

create or replace function pos_writeoff_bouquet(p_bouquet uuid, p_staff uuid, p_employee uuid, p_reason text default null)
returns void
language plpgsql
as $$
declare
  v_b pos_bouquets%rowtype;
begin
  select * into v_b from pos_bouquets where id = p_bouquet for update;
  if not found then
    raise exception 'Букет не найден';
  end if;
  if v_b.status not in ('vitrine', 'order') then
    raise exception 'Букет уже отдан';
  end if;

  update pos_bouquets
     set status = 'written_off', closed_at = now(), closed_by = p_employee,
         writeoff_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Завял')
   where id = p_bouquet;
end;
$$;

-- ---------------------------------------------------------------
-- Заказ: создать, править, вести по шагам, отменить
-- ---------------------------------------------------------------

-- Заказ и предоплата — одной транзакцией: не бывает заказа «с
-- предоплатой», деньги за который не записались, и наоборот.
-- p_prepay: null или { sale_id, shift_id, payments: [{method, amount}] }.
create or replace function pos_create_order(
  p_order jsonb, p_prepay jsonb, p_location uuid, p_staff uuid, p_employee uuid)
returns jsonb
language plpgsql
as $$
declare
  v_id      uuid := nullif(p_order->>'id', '')::uuid;
  v_no      text;
  v_total   numeric := nullif(p_order->>'total', '')::numeric;
  v_pickup  boolean := coalesce((p_order->>'is_pickup')::boolean, false);
  v_amount  numeric;
  v_sale    jsonb := null;
begin
  if v_id is null then
    raise exception 'У заказа нет идентификатора';
  end if;
  if exists (select 1 from pos_orders where id = v_id) then
    return (select jsonb_build_object('id', id, 'order_no', order_no, 'repeated', true) from pos_orders where id = v_id);
  end if;

  if nullif(p_order->>'delivery_date', '') is null then
    raise exception 'Укажите дату заказа';
  end if;
  if v_total is null or v_total < 0 then
    raise exception 'Укажите сумму заказа';
  end if;
  if nullif(trim(coalesce(p_order->>'customer_phone', '')), '') is null
     and nullif(trim(coalesce(p_order->>'recipient_phone', '')), '') is null then
    raise exception 'Нужен хотя бы один телефон — заказчика или получателя';
  end if;
  if not v_pickup and nullif(trim(coalesce(p_order->>'delivery_address', '')), '') is null then
    raise exception 'Укажите адрес доставки или выберите самовывоз';
  end if;
  if nullif(p_order->>'time_from', '') is not null and nullif(p_order->>'time_to', '') is not null
     and (p_order->>'time_to')::time <= (p_order->>'time_from')::time then
    raise exception 'Время «до» должно быть позже «с»';
  end if;

  v_no := inv_next_doc_no('order');

  insert into pos_orders
    (id, order_no, location_id, channel, customer_id, customer_name, customer_phone, recipient_name, recipient_phone,
     is_pickup, delivery_address, delivery_details, delivery_date, time_from, time_to, card_text, wishes,
     courier_comment, total, created_by, created_staff, device_id)
  values
    (v_id, v_no, p_location, coalesce(nullif(p_order->>'channel', ''), 'shop'),
     nullif(p_order->>'customer_id', '')::uuid,
     nullif(trim(coalesce(p_order->>'customer_name', '')), ''), nullif(trim(coalesce(p_order->>'customer_phone', '')), ''),
     nullif(trim(coalesce(p_order->>'recipient_name', '')), ''), nullif(trim(coalesce(p_order->>'recipient_phone', '')), ''),
     v_pickup, nullif(trim(coalesce(p_order->>'delivery_address', '')), ''),
     nullif(trim(coalesce(p_order->>'delivery_details', '')), ''),
     (p_order->>'delivery_date')::date, nullif(p_order->>'time_from', '')::time, nullif(p_order->>'time_to', '')::time,
     nullif(trim(coalesce(p_order->>'card_text', '')), ''), nullif(trim(coalesce(p_order->>'wishes', '')), ''),
     nullif(trim(coalesce(p_order->>'courier_comment', '')), ''), round(v_total, 2), p_employee, p_staff,
     nullif(p_order->>'device_id', ''));

  if p_prepay is not null and jsonb_typeof(p_prepay) = 'object' then
    select coalesce(sum((e->>'amount')::numeric), 0) into v_amount
      from jsonb_array_elements(coalesce(p_prepay->'payments', '[]'::jsonb)) e;
    if v_amount > 0 then
      v_sale := pos_record_sale(
        jsonb_build_object('id', p_prepay->>'sale_id', 'shift_id', p_prepay->>'shift_id',
                           'customer_id', p_order->>'customer_id', 'comment', 'Предоплата при оформлении'),
        jsonb_build_array(jsonb_build_object('kind', 'order', 'order_id', v_id, 'amount', v_amount)),
        p_prepay->'payments', p_staff, p_employee);
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'order_no', v_no, 'repeated', false, 'sale_no', v_sale->>'sale_no');
end;
$$;

-- Шаг заказа. Только вперёд и только туда, куда можно из текущего:
-- доставка — «собран → у курьера → доставлен», самовывоз — «собран → выдан».
create or replace function pos_set_order_status(p_order uuid, p_status text, p_staff uuid, p_employee uuid)
returns void
language plpgsql
as $$
declare
  v_o  pos_orders%rowtype;
  ok   boolean;
begin
  select * into v_o from pos_orders where id = p_order for update;
  if not found then
    raise exception 'Заказ не найден';
  end if;

  ok := case v_o.status
    when 'new'        then p_status in ('assembling', 'ready')
    when 'assembling' then p_status = 'ready'
    when 'ready'      then (p_status = 'delivering' and not v_o.is_pickup) or p_status = 'completed'
    when 'delivering' then p_status = 'completed'
    else false
  end;
  if not ok then
    raise exception 'Заказ % сейчас «%» — так его не перевести', v_o.order_no, v_o.status;
  end if;

  update pos_orders
     set status = p_status,
         closed_at = case when p_status = 'completed' then now() else closed_at end,
         closed_by = case when p_status = 'completed' then p_employee else closed_by end
   where id = p_order;

  -- Отдали — букеты к заказу считаются проданными. Деньги за них — в
  -- чеках оплаты заказа, поэтому здесь склад и касса не трогаются.
  if p_status = 'completed' then
    update pos_bouquets set status = 'sold', closed_at = now(), closed_by = p_employee
     where order_id = p_order and status = 'order';
  end if;
end;
$$;

-- Правка заказа, пока он не закрыт. Сумма не может стать меньше уже
-- оплаченного — иначе вышла бы переплата, которую некуда деть.
create or replace function pos_update_order(p_order uuid, p_patch jsonb)
returns void
language plpgsql
as $$
declare
  v_o    pos_orders%rowtype;
  v_paid numeric;
begin
  select * into v_o from pos_orders where id = p_order for update;
  if not found then
    raise exception 'Заказ не найден';
  end if;
  if v_o.status in ('completed', 'cancelled') then
    raise exception 'Заказ % закрыт — менять его нельзя', v_o.order_no;
  end if;
  v_paid := pos_order_paid(p_order);
  if p_patch ? 'total' and (p_patch->>'total')::numeric < v_paid then
    raise exception 'По заказу уже оплачено % ₽ — сумма не может быть меньше', v_paid;
  end if;
  if p_patch ? 'is_pickup' and not (p_patch->>'is_pickup')::boolean
     and nullif(trim(coalesce(p_patch->>'delivery_address', v_o.delivery_address, '')), '') is null then
    raise exception 'Укажите адрес доставки';
  end if;

  update pos_orders set
    customer_name    = case when p_patch ? 'customer_name'    then nullif(trim(p_patch->>'customer_name'), '')    else customer_name end,
    customer_phone   = case when p_patch ? 'customer_phone'   then nullif(trim(p_patch->>'customer_phone'), '')   else customer_phone end,
    recipient_name   = case when p_patch ? 'recipient_name'   then nullif(trim(p_patch->>'recipient_name'), '')   else recipient_name end,
    recipient_phone  = case when p_patch ? 'recipient_phone'  then nullif(trim(p_patch->>'recipient_phone'), '')  else recipient_phone end,
    is_pickup        = case when p_patch ? 'is_pickup'        then (p_patch->>'is_pickup')::boolean               else is_pickup end,
    delivery_address = case when p_patch ? 'delivery_address' then nullif(trim(p_patch->>'delivery_address'), '') else delivery_address end,
    delivery_details = case when p_patch ? 'delivery_details' then nullif(trim(p_patch->>'delivery_details'), '') else delivery_details end,
    delivery_date    = case when p_patch ? 'delivery_date'    then (p_patch->>'delivery_date')::date              else delivery_date end,
    time_from        = case when p_patch ? 'time_from'        then nullif(p_patch->>'time_from', '')::time        else time_from end,
    time_to          = case when p_patch ? 'time_to'          then nullif(p_patch->>'time_to', '')::time          else time_to end,
    card_text        = case when p_patch ? 'card_text'        then nullif(trim(p_patch->>'card_text'), '')        else card_text end,
    wishes           = case when p_patch ? 'wishes'           then nullif(trim(p_patch->>'wishes'), '')           else wishes end,
    courier_comment  = case when p_patch ? 'courier_comment'  then nullif(trim(p_patch->>'courier_comment'), '')  else courier_comment end,
    total            = case when p_patch ? 'total'            then round((p_patch->>'total')::numeric, 2)         else total end
  where id = p_order;
end;
$$;

-- Отмена. Что сделать с предоплатой, решает человек:
--   cash  — вернуть наличными: изъятие из кассы открытой смены;
--   other — вернули картой или переводом, мимо кассы;
--   keep  — предоплата остаётся у студии (клиент отказался сам).
-- В первых двух случаях чеки предоплаты помечаются возвратом. Собранные к
-- заказу букеты переезжают на витрину — их можно продать.
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

-- ---------------------------------------------------------------
-- Доступ
-- ---------------------------------------------------------------

alter table pos_orders enable row level security;
revoke all on table pos_orders from anon, authenticated;
grant all on table pos_orders to service_role;

revoke execute on function inv_next_doc_no(text)                                   from public, anon, authenticated;
revoke execute on function pos_shift_expected_cash(uuid)                            from public, anon, authenticated;
revoke execute on function pos_order_paid(uuid)                                     from public, anon, authenticated;
revoke execute on function pos_record_sale(jsonb, jsonb, jsonb, uuid, uuid)         from public, anon, authenticated;
revoke execute on function pos_assemble_bouquet(jsonb, jsonb, uuid, uuid, uuid)     from public, anon, authenticated;
revoke execute on function pos_disassemble_bouquet(uuid, uuid, uuid)                from public, anon, authenticated;
revoke execute on function pos_writeoff_bouquet(uuid, uuid, uuid, text)             from public, anon, authenticated;
revoke execute on function pos_create_order(jsonb, jsonb, uuid, uuid, uuid)         from public, anon, authenticated;
revoke execute on function pos_set_order_status(uuid, text, uuid, uuid)             from public, anon, authenticated;
revoke execute on function pos_update_order(uuid, jsonb)                            from public, anon, authenticated;
revoke execute on function pos_cancel_order(uuid, text, text, uuid, uuid)           from public, anon, authenticated;
revoke execute on function pos_orders_guard()                                       from public, anon, authenticated;
revoke execute on function pos_bouquets_guard()                                     from public, anon, authenticated;

grant execute on function inv_next_doc_no(text)                                   to service_role;
grant execute on function pos_shift_expected_cash(uuid)                            to service_role;
grant execute on function pos_order_paid(uuid)                                     to service_role;
grant execute on function pos_record_sale(jsonb, jsonb, jsonb, uuid, uuid)         to service_role;
grant execute on function pos_assemble_bouquet(jsonb, jsonb, uuid, uuid, uuid)     to service_role;
grant execute on function pos_disassemble_bouquet(uuid, uuid, uuid)                to service_role;
grant execute on function pos_writeoff_bouquet(uuid, uuid, uuid, text)             to service_role;
grant execute on function pos_create_order(jsonb, jsonb, uuid, uuid, uuid)         to service_role;
grant execute on function pos_set_order_status(uuid, text, uuid, uuid)             to service_role;
grant execute on function pos_update_order(uuid, jsonb)                            to service_role;
grant execute on function pos_cancel_order(uuid, text, text, uuid, uuid)           to service_role;

commit;
