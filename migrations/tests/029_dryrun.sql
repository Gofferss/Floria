-- Прогон 029_uchet_shop_orders.sql вместе с тестом в одной транзакции, с откатом.
-- Проверяет миграцию на боевой базе до того, как её применить. Сгенерирован scratch-скриптом.
begin;
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


-- ================================================================
-- Проверка ядра склада (миграция 024).
--
-- Запускается в боевой базе, но внутри транзакции, которая в конце
-- ОТКАТЫВАЕТСЯ: тестовые позиции и документы не остаются, счётчики
-- номеров не сдвигаются. Любое расхождение — RAISE EXCEPTION, и psql с
-- ON_ERROR_STOP прерывает прогон; последней строкой «ВСЕ ПРОВЕРКИ ПРОШЛИ»
-- выводится только при полном успехе.
--
-- Запуск: psql -v ON_ERROR_STOP=1 -f migrations/tests/024_warehouse_core_test.sql
-- ================================================================



do $$
declare
  loc   uuid;
  eus   uuid;   -- «эустома»: основной подопытный
  rose  uuid;   -- «роза»: вторая позиция в общем документе
  r1    uuid;
  r2    uuid;
  w     uuid;
  inv   uuid;
  rev   uuid;
  tmp   uuid;
  q     numeric;
  a     numeric;
  n     integer;
  ln    record;
begin
  select id into loc from inv_locations where is_default;
  if loc is null then
    raise exception 'ТЕСТ 0: нет места хранения по умолчанию';
  end if;

  insert into inv_items (title) values ('ТЕСТ эустома') returning id into eus;
  insert into inv_items (title) values ('ТЕСТ роза')    returning id into rose;

  -- 1. Два прихода по разной цене → остаток и скользящая средняя.
  insert into inv_documents (doc_type, location_id, doc_date)
  values ('receipt', loc, now() - interval '5 days') returning id into r1;
  insert into inv_document_lines (document_id, item_id, qty, unit_cost) values (r1, eus, 10, 100);
  perform inv_post_document(r1, null);

  insert into inv_documents (doc_type, location_id, doc_date)
  values ('receipt', loc, now() - interval '1 day') returning id into r2;
  insert into inv_document_lines (document_id, item_id, qty, unit_cost, sort)
  values (r2, eus, 10, 200, 0), (r2, rose, 5, 80, 1);
  perform inv_post_document(r2, null);

  select qty into q from inv_stock where item_id = eus and location_id = loc;
  select avg_cost into a from inv_items where id = eus;
  if q <> 20 then raise exception 'ТЕСТ 1: остаток % вместо 20', q; end if;
  if a <> 150 then raise exception 'ТЕСТ 1: средняя % вместо 150', a; end if;
  if (select total_cost from inv_documents where id = r2) <> 2400 then
    raise exception 'ТЕСТ 1: сумма прихода % вместо 2400', (select total_cost from inv_documents where id = r2);
  end if;
  raise notice 'OK 1: два прихода — остаток 20, средняя 150 ₽, сумма второго 2 400 ₽';

  -- 2. Номер документа выдаётся сам и в нужном виде.
  if (select doc_no from inv_documents where id = r1) !~ '^ПР-\d{4}$' then
    raise exception 'ТЕСТ 2: номер прихода «%»', (select doc_no from inv_documents where id = r1);
  end if;
  raise notice 'OK 2: номер прихода %', (select doc_no from inv_documents where id = r1);

  -- 3. Списание замораживает среднюю в строке.
  insert into inv_documents (doc_type, location_id) values ('writeoff', loc) returning id into w;
  insert into inv_document_lines (document_id, item_id, qty) values (w, eus, 5);
  perform inv_post_document(w, null);

  select qty_delta, unit_cost, amount into ln from inv_document_lines where document_id = w;
  if ln.qty_delta <> -5 or ln.unit_cost <> 150 or ln.amount <> -750 then
    raise exception 'ТЕСТ 3: строка списания %', ln;
  end if;
  select qty into q from inv_stock where item_id = eus and location_id = loc;
  if q <> 15 then raise exception 'ТЕСТ 3: остаток % вместо 15', q; end if;
  if (select total_cost from inv_documents where id = w) <> 750 then
    raise exception 'ТЕСТ 3: сумма списания % вместо 750', (select total_cost from inv_documents where id = w);
  end if;
  raise notice 'OK 3: списание 5 — остаток 15, строка −750 ₽ по средней 150';

  -- 4. Свежесть по FIFO: из 15 штук 10 вчерашних и 5 пятидневных.
  select oldest_batch_days into n from inv_item_freshness where item_id = eus;
  if n is distinct from 5 then raise exception 'ТЕСТ 4: возраст старой партии % вместо 5', n; end if;
  raise notice 'OK 4: самая старая партия в остатке — 5 дней';

  -- 5. Инвентаризация: насчитали 12 при 15 по учёту.
  insert into inv_documents (doc_type, location_id) values ('inventory', loc) returning id into inv;
  insert into inv_document_lines (document_id, item_id, qty) values (inv, eus, 12);
  perform inv_post_document(inv, null);

  select qty_delta, stock_before into ln from inv_document_lines where document_id = inv;
  if ln.qty_delta <> -3 or ln.stock_before <> 15 then
    raise exception 'ТЕСТ 5: строка инвентаризации %', ln;
  end if;
  select avg_cost into a from inv_items where id = eus;
  if a <> 150 then raise exception 'ТЕСТ 5: инвентаризация сдвинула среднюю: %', a; end if;
  raise notice 'OK 5: инвентаризация 12 при 15 — изменение −3, средняя прежняя';

  -- 6. Строки проведённого документа не меняются.
  begin
    update inv_document_lines set qty = 999 where document_id = r1;
    raise exception 'ТЕСТ 6: строку проведённого документа удалось изменить';
  exception when others then
    if sqlerrm like 'ТЕСТ 6%' then raise; end if;
  end;
  begin
    insert into inv_document_lines (document_id, item_id, qty, unit_cost) values (r1, rose, 1, 1);
    raise exception 'ТЕСТ 6: в проведённый документ удалось добавить строку';
  exception when others then
    if sqlerrm like 'ТЕСТ 6%' then raise; end if;
  end;
  raise notice 'OK 6: строки проведённого документа защищены от правки и добавления';

  -- 7. Проведённый документ не удаляется и ключевые поля не меняются.
  begin
    delete from inv_documents where id = r1;
    raise exception 'ТЕСТ 7: проведённый документ удалось удалить';
  exception when others then
    if sqlerrm like 'ТЕСТ 7%' then raise; end if;
  end;
  begin
    update inv_documents set doc_date = now() - interval '30 days' where id = r1;
    raise exception 'ТЕСТ 7: у проведённого документа удалось сменить дату';
  exception when others then
    if sqlerrm like 'ТЕСТ 7%' then raise; end if;
  end;
  update inv_documents set comment = 'комментарий можно' where id = r1;
  raise notice 'OK 7: проведённое не удаляется и не правится, комментарий — можно';

  -- 8. Повторное проведение отклоняется.
  begin
    perform inv_post_document(r1, null);
    raise exception 'ТЕСТ 8: документ удалось провести дважды';
  exception when others then
    if sqlerrm like 'ТЕСТ 8%' then raise; end if;
  end;
  raise notice 'OK 8: повторное проведение отклонено';

  -- 9. Приход без цены и пустой документ не проводятся.
  insert into inv_documents (doc_type, location_id) values ('receipt', loc) returning id into tmp;
  insert into inv_document_lines (document_id, item_id, qty) values (tmp, eus, 3);
  begin
    perform inv_post_document(tmp, null);
    raise exception 'ТЕСТ 9: приход без цены провёлся';
  exception when others then
    if sqlerrm like 'ТЕСТ 9%' then raise; end if;
  end;
  delete from inv_documents where id = tmp;   -- черновик удаляется вместе со строками

  insert into inv_documents (doc_type, location_id) values ('writeoff', loc) returning id into tmp;
  begin
    perform inv_post_document(tmp, null);
    raise exception 'ТЕСТ 9: пустой документ провёлся';
  exception when others then
    if sqlerrm like 'ТЕСТ 9%' then raise; end if;
  end;
  delete from inv_documents where id = tmp;
  raise notice 'OK 9: приход без цены и пустой документ отклонены, черновики удаляются';

  -- 10. Сторно второго прихода.
  rev := inv_reverse_document(r2, null, null);

  select qty into q from inv_stock where item_id = eus and location_id = loc;
  if q <> 2 then raise exception 'ТЕСТ 10: эустома после сторно % вместо 2', q; end if;
  select qty into q from inv_stock where item_id = rose and location_id = loc;
  if q <> 0 then raise exception 'ТЕСТ 10: роза после сторно % вместо 0', q; end if;
  if (select status from inv_documents where id = r2) <> 'reversed' then
    raise exception 'ТЕСТ 10: исходный документ не помечен сторнированным';
  end if;
  if (select reversal_of from inv_documents where id = rev) is distinct from r2 then
    raise exception 'ТЕСТ 10: сторно не ссылается на исходный документ';
  end if;
  -- (12 × 150 − 10 × 200) / 2 = −100: вычесть приход из средней честно
  -- нельзя, поэтому средняя остаётся прежней.
  select avg_cost into a from inv_items where id = eus;
  if a <> 150 then raise exception 'ТЕСТ 10: средняя эустомы после сторно % вместо 150', a; end if;
  if (select total_cost from inv_documents where id = rev) <> 2400 then
    raise exception 'ТЕСТ 10: сумма сторно % вместо 2400', (select total_cost from inv_documents where id = rev);
  end if;
  raise notice 'OK 10: сторно прихода — остатки 2 и 0, исходный помечен, средняя не испорчена';

  -- 11. Сторно сторно и повторное сторно невозможны.
  begin
    perform inv_reverse_document(rev, null, null);
    raise exception 'ТЕСТ 11: удалось сторнировать сторно';
  exception when others then
    if sqlerrm like 'ТЕСТ 11%' then raise; end if;
  end;
  begin
    perform inv_reverse_document(r2, null, null);
    raise exception 'ТЕСТ 11: документ удалось сторнировать дважды';
  exception when others then
    if sqlerrm like 'ТЕСТ 11%' then raise; end if;
  end;
  raise notice 'OK 11: повторное сторно и сторно сторно отклонены';

  -- 12. Списание в минус проходит, а приход «на минус» не портит среднюю.
  insert into inv_documents (doc_type, location_id) values ('writeoff', loc) returning id into tmp;
  insert into inv_document_lines (document_id, item_id, qty) values (tmp, eus, 10);
  perform inv_post_document(tmp, null);
  select qty into q from inv_stock where item_id = eus and location_id = loc;
  if q <> -8 then raise exception 'ТЕСТ 12: остаток % вместо −8', q; end if;

  insert into inv_documents (doc_type, location_id) values ('receipt', loc) returning id into tmp;
  insert into inv_document_lines (document_id, item_id, qty, unit_cost) values (tmp, eus, 10, 300);
  perform inv_post_document(tmp, null);
  select qty into q from inv_stock where item_id = eus and location_id = loc;
  select avg_cost into a from inv_items where id = eus;
  if q <> 2 then raise exception 'ТЕСТ 12: остаток % вместо 2', q; end if;
  if a <> 300 then raise exception 'ТЕСТ 12: средняя % вместо 300', a; end if;
  raise notice 'OK 12: списание в минус прошло, приход после минуса дал среднюю 300';

  -- 13. Кэш остатков сходится с журналом.
  select count(*) into n from inv_stock_check;
  if n <> 0 then raise exception 'ТЕСТ 13: % расхождений кэша с журналом', n; end if;
  raise notice 'OK 13: кэш остатков сходится с журналом';

  -- 14. Ни anon, ни authenticated не видят склада и не вызывают функции.
  if has_table_privilege('anon', 'inv_items', 'select')
     or has_table_privilege('authenticated', 'inv_items', 'select')
     or has_table_privilege('anon', 'inv_documents', 'insert')
     or has_table_privilege('authenticated', 'inv_document_lines', 'update')
     or has_table_privilege('anon', 'inv_stock', 'select')
     or has_table_privilege('anon', 'inv_stock_check', 'select')
     or has_table_privilege('authenticated', 'inv_item_freshness', 'select') then
    raise exception 'ТЕСТ 14: у anon или authenticated есть доступ к таблицам склада';
  end if;
  if has_function_privilege('anon', 'inv_post_document(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'inv_post_document(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'inv_reverse_document(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'inv_next_doc_no(text)', 'execute') then
    raise exception 'ТЕСТ 14: anon или authenticated может вызвать функцию склада';
  end if;
  if not has_function_privilege('service_role', 'inv_post_document(uuid, uuid)', 'execute') then
    raise exception 'ТЕСТ 14: у service_role нет права проводить документы';
  end if;
  raise notice 'OK 14: снаружи склад закрыт, сервер работает';
end;
$$;

select 'ВСЕ ПРОВЕРКИ ПРОШЛИ' as result;


-- ================================================================
-- Проверка сохранения черновика (миграция 026). Транзакция откатывается.
-- ================================================================



do $$
declare
  it     uuid;
  it2    uuid;
  d      uuid;
  d2     uuid;
  fixed  uuid := 'a0000000-0000-4000-8000-000000000001';
  n      integer;
begin
  insert into inv_items (title) values ('ТЕСТ гортензия') returning id into it;
  insert into inv_items (title) values ('ТЕСТ эвкалипт')  returning id into it2;

  -- 1. Новый черновик с двумя строками.
  d := inv_save_draft(
    jsonb_build_object('doc_type', 'receipt', 'comment', 'первый'),
    jsonb_build_array(
      jsonb_build_object('item_id', it,  'qty', 10, 'unit_cost', 250),
      jsonb_build_object('item_id', it2, 'qty', 5,  'unit_cost', 90)),
    null);
  select count(*) into n from inv_document_lines where document_id = d;
  if n <> 2 then raise exception 'ТЕСТ 1: строк % вместо 2', n; end if;
  if (select status from inv_documents where id = d) <> 'draft' then raise exception 'ТЕСТ 1: не черновик'; end if;
  raise notice 'OK 1: черновик с двумя строками, номер %', (select doc_no from inv_documents where id = d);

  -- 2. Повторное сохранение того же черновика перезаписывает его целиком.
  perform inv_save_draft(
    jsonb_build_object('id', d, 'doc_type', 'receipt', 'comment', 'второй'),
    jsonb_build_array(jsonb_build_object('item_id', it, 'qty', 7, 'unit_cost', 260)),
    null);
  select count(*) into n from inv_document_lines where document_id = d;
  if n <> 1 then raise exception 'ТЕСТ 2: строк % вместо 1', n; end if;
  if (select comment from inv_documents where id = d) <> 'второй' then raise exception 'ТЕСТ 2: заголовок не обновился'; end if;
  if (select count(*) from inv_documents where comment in ('первый', 'второй')) <> 1 then
    raise exception 'ТЕСТ 2: появился второй документ';
  end if;
  raise notice 'OK 2: повторное сохранение перезаписало тот же черновик';

  -- 3. Проведённый черновик больше не перезаписывается.
  perform inv_post_document(d, null);
  begin
    perform inv_save_draft(jsonb_build_object('id', d, 'doc_type', 'receipt'), '[]'::jsonb, null);
    raise exception 'ТЕСТ 3: проведённый документ удалось перезаписать';
  exception when others then
    if sqlerrm like 'ТЕСТ 3%' then raise; end if;
  end;
  raise notice 'OK 3: проведённый документ перезаписать нельзя';

  -- 4. Идентификатор, созданный устройством, сохраняется как есть, повтор не задваивает.
  perform inv_save_draft(jsonb_build_object('id', fixed, 'doc_type', 'writeoff', 'device_id', 'ipad-1'),
    jsonb_build_array(jsonb_build_object('item_id', it, 'qty', 1)), null);
  perform inv_save_draft(jsonb_build_object('id', fixed, 'doc_type', 'writeoff', 'device_id', 'ipad-1'),
    jsonb_build_array(jsonb_build_object('item_id', it, 'qty', 1)), null);
  if (select count(*) from inv_documents where id = fixed) <> 1 then raise exception 'ТЕСТ 4: документ задвоился'; end if;
  if (select device_id from inv_documents where id = fixed) <> 'ipad-1' then raise exception 'ТЕСТ 4: устройство не записалось'; end if;
  raise notice 'OK 4: документ с идентификатором устройства принят один раз';

  -- 5. Тип существующего черновика сменить нельзя.
  begin
    perform inv_save_draft(jsonb_build_object('id', fixed, 'doc_type', 'receipt'), '[]'::jsonb, null);
    raise exception 'ТЕСТ 5: тип документа удалось сменить';
  exception when others then
    if sqlerrm like 'ТЕСТ 5%' then raise; end if;
  end;
  raise notice 'OK 5: тип документа не меняется';

  -- 6. Строка без позиции или количества отклоняется, документ не создаётся.
  select count(*) into n from inv_documents;
  begin
    d2 := inv_save_draft(jsonb_build_object('doc_type', 'writeoff'),
      jsonb_build_array(jsonb_build_object('item_id', it)), null);
    raise exception 'ТЕСТ 6: строка без количества принята';
  exception when others then
    if sqlerrm like 'ТЕСТ 6%' then raise; end if;
  end;
  if (select count(*) from inv_documents) <> n then raise exception 'ТЕСТ 6: после ошибки остался документ'; end if;
  raise notice 'OK 6: неполная строка отклонена, ничего не записано';

  -- 7. Снаружи функцию не вызвать.
  if has_function_privilege('anon', 'inv_save_draft(jsonb, jsonb, uuid)', 'execute')
     or has_function_privilege('authenticated', 'inv_save_draft(jsonb, jsonb, uuid)', 'execute') then
    raise exception 'ТЕСТ 7: anon или authenticated может сохранять документы';
  end if;
  raise notice 'OK 7: сохранять документы может только сервер';
end;
$$;

select 'ВСЕ ПРОВЕРКИ ПРОШЛИ' as result;


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


rollback;
