-- ================================================================
-- Флория Учёт, этап 2: торговый зал.
--
-- Люди с PIN, смены и наличные, витрина собранных букетов, продажи.
-- Устройство то же, что у склада (024): всё, что меняет остаток, — это
-- проведённый документ склада, а продажа, сборка и разборка только
-- создают такие документы. Поэтому журнал склада остаётся единственным
-- источником остатков, и inv_stock_check по-прежнему обязан быть пуст.
--
-- Что добавляется:
--   * hr_employees         — люди, которые работают за планшетом (PIN);
--   * pos_settings         — правила кассы, которые меняет владелец;
--   * pos_payment_methods  — способы оплаты (список, а не константы);
--   * pos_cash_reasons     — причины внесения и изъятия наличных;
--   * pos_shifts, pos_cash_movements — смены и движения наличных;
--   * pos_bouquets         — каждый собранный букет: на витрине, продан,
--                            разобран или списан;
--   * pos_sales            — чеки: строки, оплаты, документ склада.
--
-- Новые типы документов склада: сборка (assembly) и продажа (sale)
-- списывают, разборка (disassembly) и возврат (return) приходуют по той
-- цене, по которой цветы ушли.
--
-- Бонусы клиентов пока ведёт Posiflora: в customers.bonus_balance лежит
-- её баланс. Поэтому касса здесь бонусы не списывает и не начисляет, пока
-- владелец не переведёт их к нам (pos_settings.bonuses_enabled). Иначе
-- одна покупка изменила бы баланс в двух местах, а синхронизация с
-- Posiflora молча затирала бы наш.
--
-- Безопасность — как в 024: RLS без политик, гранты сняты с anon и
-- authenticated, EXECUTE функций — только service_role.
-- ================================================================

begin;

-- ================================================================
-- Значки групп
-- ================================================================

-- Группа узнаётся по значку, а не по цвету заливки: роза, хризантема,
-- игрушки, шары. Ключ значка — из набора в components/uchet/GroupIcon.tsx;
-- владелец меняет его в справочнике. Ограничения в базе нет намеренно:
-- новый значок в приложении не должен требовать миграции.
alter table inv_groups add column if not exists icon text;

update inv_groups set icon = case
    when lower(title) like '%кустов%'   then 'spray'
    when lower(title) like '%роз%'      then 'rose'
    when lower(title) like '%хризант%'  then 'chrys'
    when lower(title) like '%горш%'     then 'pot'
    when lower(title) like '%игруш%'    then 'bear'
    when lower(title) like '%искусств%' then 'artificial'
    when lower(title) like '%сухоцв%'   then 'dried'
    when lower(title) like '%упаков%'   then 'wrap'
    when lower(title) like '%услуг%'    then 'scissors'
    when lower(title) like '%уценк%'    then 'sale'
    when lower(title) like '%открыт%'   then 'card'
    when lower(title) like '%шар%'      then 'balloon'
    when lower(title) like '%букет%'    then 'bouquet'
    when lower(title) like '%зелен%'    then 'leaf'
    when lower(title) like '%подар%'    then 'gift'
    when lower(title) like 'дом%'       then 'home'
    else case kind
      when 'flower'    then 'tulip'
      when 'greenery'  then 'leaf'
      when 'decor'     then 'dried'
      when 'packaging' then 'wrap'
      when 'gift'      then 'gift'
      when 'print'     then 'card'
      when 'service'   then 'scissors'
      when 'bouquet'   then 'bouquet'
      else 'other'
    end
  end
where icon is null;

comment on column inv_groups.icon is 'Ключ значка группы (components/uchet/GroupIcon.tsx).';

-- ================================================================
-- Люди
-- ================================================================

-- Учётная запись (staff) — это вход: у айпада магазина она одна на всех.
-- Человек — это тот, кто сейчас за ним работает. Он выбирает себя и вводит
-- PIN, и каждое действие подписано им: так видно, кто продал и кто
-- списал, и так будут считаться проценты с продаж.
create table if not exists hr_employees (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,
  short_name        text not null,
  position          text not null default 'florist'
                    check (position in ('owner','admin','florist','assistant','courier')),
  -- Может подтвердить своим PIN то, что флористу самому нельзя:
  -- скидку сверх лимита.
  can_approve       boolean not null default false,
  -- scrypt-хэш PIN (lib/uchet/pin.ts). Пусто — PIN не задан, войти нельзя.
  pin_hash          text,
  pin_failed        integer not null default 0,
  pin_locked_until  timestamptz,
  -- Личный вход, если у человека он есть (владельцы): тогда на своём
  -- устройстве PIN не нужен — учётная запись уже говорит, кто это.
  staff_id          uuid unique references staff(id) on delete set null,
  sort              integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table hr_employees is 'Люди, которые работают за планшетом. Вход по PIN поверх общей учётной записи магазина.';
comment on column hr_employees.pin_hash is 'scrypt-хэш PIN. Сам PIN нигде не хранится.';

drop trigger if exists hr_employees_updated on hr_employees;
create trigger hr_employees_updated before update on hr_employees
  for each row execute function set_updated_at();

-- ================================================================
-- Новые типы документов склада
-- ================================================================

alter table inv_documents
  add column if not exists employee_id uuid references hr_employees(id) on delete set null;

comment on column inv_documents.employee_id is 'Кто сделал — человек за планшетом (created_by — учётная запись).';

alter table inv_documents drop constraint if exists inv_documents_doc_type_check;
alter table inv_documents add constraint inv_documents_doc_type_check
  check (doc_type in ('opening','receipt','writeoff','inventory','assembly','disassembly','sale','return'));

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
    else 'ДК'
  end;
begin
  insert into inv_doc_counters (doc_type, last_no) values (p_type, 1)
  on conflict (doc_type) do update set last_no = inv_doc_counters.last_no + 1
  returning last_no into n;
  return prefix || '-' || lpad(n::text, 4, '0');
end;
$$;

-- Проведение — то же, что в 024, плюс новые типы. Расход (списание,
-- сборка, продажа) идёт по средней на момент проведения. Приход по
-- разборке и возврату — по цене, переданной в строке (той, по которой
-- цветы ушли), и пересчитывает среднюю, как обычный приход.
create or replace function inv_post_document(p_doc uuid, p_staff uuid default null)
returns void
language plpgsql
as $$
declare
  d         inv_documents%rowtype;
  l         record;
  cur_qty   numeric;
  cur_avg   numeric;
  base_qty  numeric;
  delta     numeric;
  cost      numeric;
  new_avg   numeric;
  total     numeric := 0;
  n         integer := 0;
begin
  select * into d from inv_documents where id = p_doc for update;
  if not found then
    raise exception 'Документ не найден';
  end if;
  if d.status <> 'draft' then
    raise exception 'Документ % уже проведён', d.doc_no;
  end if;

  perform 1 from inv_items
   where id in (select item_id from inv_document_lines where document_id = p_doc)
   order by id
   for update;

  for l in
    select * from inv_document_lines where document_id = p_doc order by sort, created_at, id
  loop
    n := n + 1;

    select s.qty into cur_qty from inv_stock s
     where s.item_id = l.item_id and s.location_id = d.location_id;
    cur_qty := coalesce(cur_qty, 0);
    select avg_cost into cur_avg from inv_items where id = l.item_id;

    if d.doc_type in ('opening', 'receipt', 'disassembly', 'return') then
      if l.qty = 0 then
        raise exception 'Строка %: укажите количество', n;
      end if;
      if d.doc_type = 'receipt' and l.unit_cost is null then
        raise exception 'Строка %: в приходе нужна цена закупки', n;
      end if;

      delta := l.qty;
      cost := coalesce(l.unit_cost, cur_avg);

      base_qty := greatest(cur_qty, 0);
      if base_qty + delta > 0 then
        new_avg := (base_qty * cur_avg + delta * cost) / (base_qty + delta);
        update inv_items set avg_cost = round(new_avg, 4) where id = l.item_id;
      end if;

    elsif d.doc_type in ('writeoff', 'assembly', 'sale') then
      if l.qty = 0 then
        raise exception 'Строка %: укажите количество', n;
      end if;
      delta := -l.qty;
      cost := cur_avg;

    elsif d.doc_type = 'inventory' then
      delta := l.qty - cur_qty;
      cost := cur_avg;
      update inv_document_lines set stock_before = cur_qty where id = l.id;

    else
      raise exception 'Проведение документов типа «%» не поддерживается', d.doc_type;
    end if;

    update inv_document_lines
       set qty_delta = delta,
           unit_cost = round(cost, 4),
           amount    = round(delta * cost, 2)
     where id = l.id;

    insert into inv_stock (item_id, location_id, qty, updated_at)
    values (l.item_id, d.location_id, delta, now())
    on conflict (item_id, location_id)
      do update set qty = inv_stock.qty + excluded.qty, updated_at = now();

    total := total + abs(round(delta * cost, 2));
  end loop;

  if n = 0 then
    raise exception 'В документе нет строк';
  end if;

  update inv_documents
     set status = 'posted', posted_by = p_staff, posted_at = now(), total_cost = total
   where id = p_doc;
end;
$$;

-- Сторно — как в 024, но документы кассы через него не отменяются:
-- продажа отменяется возвратом, сборка — разборкой букета. Иначе чек
-- остался бы «оплачен», а цветы вернулись бы на склад, и учёт разошёлся
-- бы с деньгами.
create or replace function inv_reverse_document(p_doc uuid, p_staff uuid default null, p_comment text default null)
returns uuid
language plpgsql
as $$
declare
  d         inv_documents%rowtype;
  new_id    uuid;
  l         record;
  cur_qty   numeric;
  cur_avg   numeric;
  rest_qty  numeric;
  rest_avg  numeric;
  total     numeric := 0;
begin
  select * into d from inv_documents where id = p_doc for update;
  if not found then
    raise exception 'Документ не найден';
  end if;
  if d.doc_type in ('assembly', 'disassembly', 'sale', 'return') then
    raise exception 'Документ % создан кассой: продажу отменяют возвратом, сборку — разборкой букета', d.doc_no;
  end if;
  if d.status <> 'posted' then
    raise exception 'Сторно возможно только для проведённого документа (% — %)', d.doc_no, d.status;
  end if;
  if d.reversal_of is not null then
    raise exception 'Документ % сам является сторно — его отменить нельзя', d.doc_no;
  end if;

  perform 1 from inv_items
   where id in (select item_id from inv_document_lines where document_id = p_doc)
   order by id
   for update;

  insert into inv_documents
    (doc_type, status, location_id, doc_date, supplier_id, writeoff_reason_id,
     payment_method, comment, reversal_of, created_by)
  values
    (d.doc_type, 'draft', d.location_id, now(), d.supplier_id, d.writeoff_reason_id,
     d.payment_method, coalesce(nullif(trim(p_comment), ''), 'Сторно ' || d.doc_no), d.id, p_staff)
  returning id into new_id;

  for l in
    select * from inv_document_lines where document_id = p_doc order by sort, created_at, id
  loop
    select s.qty into cur_qty from inv_stock s
     where s.item_id = l.item_id and s.location_id = d.location_id;
    cur_qty := coalesce(cur_qty, 0);
    select avg_cost into cur_avg from inv_items where id = l.item_id;

    if l.qty_delta > 0 and d.doc_type in ('opening', 'receipt') then
      rest_qty := greatest(cur_qty, 0) - l.qty_delta;
      if rest_qty > 0 then
        rest_avg := (greatest(cur_qty, 0) * cur_avg - l.qty_delta * l.unit_cost) / rest_qty;
        if rest_avg >= 0 then
          update inv_items set avg_cost = round(rest_avg, 4) where id = l.item_id;
        end if;
      end if;
    end if;

    insert into inv_document_lines
      (document_id, item_id, qty, qty_delta, unit_cost, amount, stock_before, sort)
    values
      (new_id, l.item_id, l.qty, -l.qty_delta, l.unit_cost, -l.amount, null, l.sort);

    insert into inv_stock (item_id, location_id, qty, updated_at)
    values (l.item_id, d.location_id, -l.qty_delta, now())
    on conflict (item_id, location_id)
      do update set qty = inv_stock.qty + excluded.qty, updated_at = now();

    total := total + abs(l.amount);
  end loop;

  update inv_documents
     set status = 'posted', posted_by = p_staff, posted_at = now(), total_cost = total
   where id = new_id;

  update inv_documents set status = 'reversed' where id = p_doc;

  return new_id;
end;
$$;

-- Свежесть: разобранный букет и возврат — это старые цветы, а не новая
-- партия. Если считать их поступлением, вчерашняя эустома из разобранного
-- букета выглядела бы как привезённая сегодня.
create or replace view inv_item_freshness
with (security_invoker = on)
as
with incoming as (
  select l.item_id, d.location_id, d.doc_date, l.qty_delta as q
    from inv_document_lines l
    join inv_documents d on d.id = l.document_id
   where d.status = 'posted'
     and d.reversal_of is null
     and d.doc_type not in ('disassembly', 'return')
     and l.qty_delta > 0
),
ranked as (
  select item_id, location_id, doc_date, q,
         sum(q) over (partition by item_id, location_id order by doc_date desc, q
                      rows between unbounded preceding and current row) as cum
    from incoming
)
select s.item_id,
       s.location_id,
       s.qty,
       min(r.doc_date) as oldest_batch_at,
       floor(extract(epoch from (now() - min(r.doc_date))) / 86400)::int as oldest_batch_days
  from inv_stock s
  join ranked r on r.item_id = s.item_id and r.location_id = s.location_id
 where s.qty > 0
   and r.cum - r.q < s.qty
 group by s.item_id, s.location_id, s.qty;

-- ================================================================
-- Правила кассы
-- ================================================================

create table if not exists pos_settings (
  id                      boolean primary key default true check (id),
  -- До этой скидки флорист даёт сам, больше — PIN того, у кого can_approve.
  discount_limit_percent  numeric(5,2) not null default 10
                          check (discount_limit_percent between 0 and 100),
  -- Можно ли продать букет без состава («букет по цене»). По умолчанию
  -- можно: так сейчас продают «БУКЕТ 2000» в Posiflora.
  composition_required    boolean not null default false,
  -- Бонусы ведёт Posiflora, пока владелец не переведёт их к нам.
  bonuses_enabled         boolean not null default false,
  bonus_percent           numeric(5,2) not null default 5
                          check (bonus_percent between 0 and 100),
  updated_at              timestamptz not null default now()
);

comment on table pos_settings is 'Правила кассы. Одна строка; меняет владелец.';

insert into pos_settings (id) values (true) on conflict (id) do nothing;

create table if not exists pos_payment_methods (
  code        text primary key,
  title       text not null,
  -- Наличные попадают в расчёт «сколько должно быть в кассе».
  is_cash     boolean not null default false,
  sort        integer not null default 0,
  is_active   boolean not null default true
);

comment on table pos_payment_methods is 'Способы оплаты в кассе. Список правит владелец.';

insert into pos_payment_methods (code, title, is_cash, sort) values
  ('cash',     'Наличные', true,  10),
  ('card',     'Карта',    false, 20),
  ('sbp',      'СБП',      false, 30),
  ('transfer', 'Перевод',  false, 40)
on conflict (code) do nothing;

create table if not exists pos_cash_reasons (
  id          uuid primary key default gen_random_uuid(),
  direction   text not null check (direction in ('in', 'out')),
  title       text not null,
  -- Смысл причины для логики: закупка открывает приход на склад, зарплата
  -- требует выбрать человека. Остальное — просто подпись.
  kind        text not null default 'other' check (kind in ('purchase', 'salary', 'collection', 'other')),
  sort        integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (direction, title)
);

comment on table pos_cash_reasons is
  'Причины внесения и изъятия наличных. Сейчас в Posiflora их 41 вида «Эустома» и «Зарплата Даня» — по таким не построить отчёт.';

insert into pos_cash_reasons (direction, title, kind, sort) values
  ('out', 'Закупка цветов',       'purchase',   10),
  ('out', 'Зарплата',             'salary',     20),
  ('out', 'Инкассация',           'collection', 30),
  ('out', 'Хозяйственные',        'other',      40),
  ('out', 'Доставка, такси',      'other',      50),
  ('out', 'Другое',               'other',      90),
  ('in',  'Размен',               'other',      10),
  ('in',  'Сдача с закупки',      'other',      20),
  ('in',  'Другое',               'other',      90)
on conflict (direction, title) do nothing;

-- ================================================================
-- Смены и наличные
-- ================================================================

create table if not exists pos_shifts (
  id                     uuid primary key default gen_random_uuid(),
  location_id            uuid not null references inv_locations(id),
  status                 text not null default 'open' check (status in ('open', 'closed')),
  opened_at              timestamptz not null default now(),
  opened_by              uuid references hr_employees(id) on delete set null,
  opened_staff           uuid references staff(id) on delete set null,
  opening_cash           numeric(12,2) not null check (opening_cash >= 0),
  -- Сколько насчитали при закрытии прошлой смены — чтобы при открытии
  -- сразу было видно, если за ночь в кассе что-то изменилось.
  previous_counted_cash  numeric(12,2),
  closed_at              timestamptz,
  closed_by              uuid references hr_employees(id) on delete set null,
  closed_staff           uuid references staff(id) on delete set null,
  expected_cash          numeric(12,2),
  counted_cash           numeric(12,2) check (counted_cash is null or counted_cash >= 0),
  comment                text,
  device_id              text,
  created_at             timestamptz not null default now()
);

comment on table pos_shifts is 'Смены кассы. Открытая в каждом месте — не больше одной.';

create unique index if not exists pos_shifts_one_open on pos_shifts (location_id) where status = 'open';
create index if not exists pos_shifts_opened on pos_shifts (location_id, opened_at desc);

create table if not exists pos_cash_movements (
  id                uuid primary key default gen_random_uuid(),
  shift_id          uuid not null references pos_shifts(id),
  direction         text not null check (direction in ('in', 'out')),
  reason_id         uuid not null references pos_cash_reasons(id),
  amount            numeric(12,2) not null check (amount > 0),
  employee_id       uuid references hr_employees(id) on delete set null,
  staff_id          uuid references staff(id) on delete set null,
  -- Кому выдана зарплата.
  paid_employee_id  uuid references hr_employees(id) on delete set null,
  -- Приход на склад, оплаченный этими деньгами.
  receipt_doc_id    uuid references inv_documents(id) on delete set null,
  comment           text,
  device_id         text,
  created_at        timestamptz not null default now()
);

comment on table pos_cash_movements is 'Внесения и изъятия наличных. Не правятся и не удаляются: ошибку исправляют обратным движением.';

create index if not exists pos_cash_movements_shift on pos_cash_movements (shift_id);

create or replace function pos_cash_movements_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Движение наличных не удаляется — запишите обратное движение';
  end if;
  if new.shift_id is distinct from old.shift_id
     or new.direction is distinct from old.direction
     or new.reason_id is distinct from old.reason_id
     or new.amount is distinct from old.amount
     or new.employee_id is distinct from old.employee_id
     or new.paid_employee_id is distinct from old.paid_employee_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Движение наличных не правится — запишите обратное движение';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_cash_movements_guard on pos_cash_movements;
create trigger pos_cash_movements_guard before update or delete on pos_cash_movements
  for each row execute function pos_cash_movements_guard();

-- ================================================================
-- Букеты
-- ================================================================

-- Каждый собранный букет — запись: и тот, что поставили на витрину, и тот,
-- что собрали прямо в чеке. Так у каждого букета есть состав, цена,
-- автор и судьба, и отчёт «что продаём» строится из одного места.
create table if not exists pos_bouquets (
  id               uuid primary key default gen_random_uuid(),
  location_id      uuid not null references inv_locations(id),
  title            text not null,
  price            numeric(12,2) not null check (price >= 0),
  status           text not null check (status in ('vitrine', 'sold', 'disassembled', 'written_off')),
  -- Нет состава — «букет по цене»: цветы со склада не списались.
  has_composition  boolean not null default true,
  photo_urls       text[] not null default '{}',
  assembled_by     uuid references hr_employees(id) on delete set null,
  assembled_staff  uuid references staff(id) on delete set null,
  assembled_at     timestamptz not null default now(),
  -- Документ сборки — только у букетов витрины: их цветы списываются при
  -- сборке. У букета из чека цветы списывает документ продажи.
  assembly_doc_id  uuid references inv_documents(id),
  -- Себестоимость состава на момент сборки. Только владельцам.
  cost             numeric(14,2),
  sale_id          uuid,
  closed_at        timestamptz,
  closed_by        uuid references hr_employees(id) on delete set null,
  writeoff_reason  text,
  comment          text,
  device_id        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table pos_bouquets is 'Собранные букеты: витрина и проданные. Состав — pos_bouquet_items.';

create index if not exists pos_bouquets_status on pos_bouquets (location_id, status, assembled_at);

create table if not exists pos_bouquet_items (
  bouquet_id  uuid not null references pos_bouquets(id) on delete cascade,
  item_id     uuid not null references inv_items(id),
  qty         numeric(12,3) not null check (qty > 0),
  primary key (bouquet_id, item_id)
);

drop trigger if exists pos_bouquets_updated on pos_bouquets;
create trigger pos_bouquets_updated before update on pos_bouquets
  for each row execute function set_updated_at();

-- С витрины букет уходит один раз. После продажи, разборки или списания
-- у него меняются только фото (их досылают клиенту) и комментарий.
create or replace function pos_bouquets_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Букет не удаляется — его продают, разбирают или списывают';
  end if;
  if old.status = 'vitrine' then
    if new.assembly_doc_id is distinct from old.assembly_doc_id
       or new.location_id is distinct from old.location_id
       or new.cost is distinct from old.cost then
      raise exception 'Состав и себестоимость букета на витрине не правятся — разберите и соберите заново';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.price is distinct from old.price
     or new.title is distinct from old.title
     or new.sale_id is distinct from old.sale_id
     or new.cost is distinct from old.cost then
    raise exception 'Букет уже не на витрине — менять можно только фото и комментарий';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_bouquets_guard on pos_bouquets;
create trigger pos_bouquets_guard before update or delete on pos_bouquets
  for each row execute function pos_bouquets_guard();

-- ================================================================
-- Продажи
-- ================================================================

create table if not exists pos_sales (
  id                    uuid primary key default gen_random_uuid(),
  sale_no               text not null unique,
  location_id           uuid not null references inv_locations(id),
  shift_id              uuid not null references pos_shifts(id),
  status                text not null default 'paid' check (status in ('paid', 'returned')),
  customer_id           uuid references customers(id) on delete set null,
  employee_id           uuid references hr_employees(id) on delete set null,
  staff_id              uuid references staff(id) on delete set null,
  subtotal              numeric(12,2) not null check (subtotal >= 0),
  discount_percent      numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  discount_amount       numeric(12,2) not null default 0 check (discount_amount >= 0),
  discount_approved_by  uuid references hr_employees(id) on delete set null,
  bonus_used            numeric(12,2) not null default 0 check (bonus_used >= 0),
  bonus_earned          numeric(12,2) not null default 0 check (bonus_earned >= 0),
  total                 numeric(12,2) not null check (total >= 0),
  inv_document_id       uuid references inv_documents(id),
  comment               text,
  device_id             text,
  created_at            timestamptz not null default now()
);

comment on table pos_sales is 'Чеки кассы (учёт, не фискальный чек). Не правятся: отмена — возврат.';

create index if not exists pos_sales_shift on pos_sales (shift_id);
create index if not exists pos_sales_created on pos_sales (location_id, created_at desc);
create index if not exists pos_sales_customer on pos_sales (customer_id);

alter table pos_bouquets drop constraint if exists pos_bouquets_sale_fk;
alter table pos_bouquets add constraint pos_bouquets_sale_fk foreign key (sale_id) references pos_sales(id);

create table if not exists pos_sale_lines (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references pos_sales(id) on delete cascade,
  kind         text not null check (kind in ('bouquet', 'vitrine', 'item')),
  title        text not null,
  qty          numeric(12,3) not null default 1 check (qty > 0),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  -- Цена по прайсу в момент продажи: у позиции — её цена продажи, у
  -- букета — сумма цен состава. Сравнение с unit_price показывает
  -- владельцу, где цену поставили руками.
  list_price   numeric(12,2),
  amount       numeric(12,2) not null check (amount >= 0),
  bouquet_id   uuid references pos_bouquets(id),
  item_id      uuid references inv_items(id),
  sort         integer not null default 0
);

create index if not exists pos_sale_lines_sale on pos_sale_lines (sale_id);

create table if not exists pos_payments (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references pos_sales(id) on delete cascade,
  method      text not null references pos_payment_methods(code),
  amount      numeric(12,2) not null check (amount > 0),
  created_at  timestamptz not null default now()
);

create index if not exists pos_payments_sale on pos_payments (sale_id);

-- Чек после оплаты не правится. Возврат (позже) меняет только статус.
create or replace function pos_sales_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Чек не удаляется — оформите возврат';
  end if;
  if new.status = old.status and new.comment is distinct from old.comment
     and row(new.sale_no, new.location_id, new.shift_id, new.customer_id, new.employee_id, new.subtotal,
             new.discount_percent, new.discount_amount, new.bonus_used, new.bonus_earned, new.total, new.inv_document_id)
         is not distinct from
         row(old.sale_no, old.location_id, old.shift_id, old.customer_id, old.employee_id, old.subtotal,
             old.discount_percent, old.discount_amount, old.bonus_used, old.bonus_earned, old.total, old.inv_document_id) then
    return new;
  end if;
  if old.status = 'paid' and new.status = 'returned'
     and row(new.sale_no, new.location_id, new.shift_id, new.customer_id, new.employee_id, new.subtotal,
             new.discount_percent, new.discount_amount, new.bonus_used, new.bonus_earned, new.total, new.inv_document_id)
         is not distinct from
         row(old.sale_no, old.location_id, old.shift_id, old.customer_id, old.employee_id, old.subtotal,
             old.discount_percent, old.discount_amount, old.bonus_used, old.bonus_earned, old.total, old.inv_document_id) then
    return new;
  end if;
  raise exception 'Чек % после оплаты не правится — оформите возврат', old.sale_no;
end;
$$;

drop trigger if exists pos_sales_guard on pos_sales;
create trigger pos_sales_guard before update or delete on pos_sales
  for each row execute function pos_sales_guard();

-- Строки и оплаты пишутся только вместе с чеком, в той же транзакции.
create or replace function pos_sale_children_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from pos_sales where id = new.sale_id and created_at < now()) then
      raise exception 'Чек уже оплачен — добавить в него строку или оплату нельзя';
    end if;
    return new;
  end if;
  raise exception 'Строки и оплаты чека не правятся — оформите возврат';
end;
$$;

drop trigger if exists pos_sale_lines_guard on pos_sale_lines;
create trigger pos_sale_lines_guard before insert or update or delete on pos_sale_lines
  for each row execute function pos_sale_children_guard();

drop trigger if exists pos_payments_guard on pos_payments;
create trigger pos_payments_guard before insert or update or delete on pos_payments
  for each row execute function pos_sale_children_guard();

-- ================================================================
-- Функции: смена
-- ================================================================

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
            where x.shift_id = s.id and m.is_cash and x.status = 'paid'), 0)
       + coalesce((
           select sum(case when c.direction = 'in' then c.amount else -c.amount end)
             from pos_cash_movements c
            where c.shift_id = s.id), 0)
    from pos_shifts s
   where s.id = p_shift;
$$;

comment on function pos_shift_expected_cash(uuid) is
  'Сколько наличных должно быть в кассе: открытие + наличные оплаты + внесения − изъятия.';

create or replace function pos_open_shift(
  p_id uuid, p_location uuid, p_cash numeric, p_staff uuid, p_employee uuid, p_device text default null)
returns uuid
language plpgsql
as $$
declare
  v_open  pos_shifts%rowtype;
  v_prev  numeric;
begin
  if p_id is not null and exists (select 1 from pos_shifts where id = p_id) then
    return p_id;  -- повтор с устройства
  end if;
  if p_cash is null or p_cash < 0 then
    raise exception 'Укажите, сколько наличных в кассе';
  end if;
  if not exists (select 1 from inv_locations where id = p_location and is_active) then
    raise exception 'Место не найдено';
  end if;

  select * into v_open from pos_shifts where location_id = p_location and status = 'open';
  if found then
    raise exception 'Смена уже открыта с %', to_char(v_open.opened_at at time zone 'Europe/Simferopol', 'DD.MM HH24:MI');
  end if;

  select counted_cash into v_prev
    from pos_shifts
   where location_id = p_location and status = 'closed'
   order by closed_at desc
   limit 1;

  insert into pos_shifts (id, location_id, opened_by, opened_staff, opening_cash, previous_counted_cash, device_id)
  values (coalesce(p_id, gen_random_uuid()), p_location, p_employee, p_staff, round(p_cash, 2), v_prev, p_device)
  returning id into p_id;

  return p_id;
end;
$$;

create or replace function pos_close_shift(
  p_shift uuid, p_counted numeric, p_staff uuid, p_employee uuid, p_comment text default null)
returns jsonb
language plpgsql
as $$
declare
  v_shift     pos_shifts%rowtype;
  v_expected  numeric;
begin
  select * into v_shift from pos_shifts where id = p_shift for update;
  if not found then
    raise exception 'Смена не найдена';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'Смена уже закрыта';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'Укажите, сколько наличных насчитали';
  end if;

  v_expected := pos_shift_expected_cash(p_shift);

  update pos_shifts
     set status = 'closed', closed_at = now(), closed_by = p_employee, closed_staff = p_staff,
         expected_cash = v_expected, counted_cash = round(p_counted, 2),
         comment = nullif(trim(coalesce(p_comment, '')), '')
   where id = p_shift;

  return jsonb_build_object('expected', v_expected, 'counted', round(p_counted, 2), 'diff', round(p_counted, 2) - v_expected);
end;
$$;

create or replace function pos_cash_move(
  p_id uuid, p_shift uuid, p_reason uuid, p_amount numeric, p_staff uuid, p_employee uuid,
  p_paid_employee uuid default null, p_comment text default null, p_device text default null)
returns uuid
language plpgsql
as $$
declare
  v_shift   pos_shifts%rowtype;
  v_reason  pos_cash_reasons%rowtype;
begin
  if p_id is not null and exists (select 1 from pos_cash_movements where id = p_id) then
    return p_id;
  end if;

  select * into v_shift from pos_shifts where id = p_shift for update;
  if not found or v_shift.status <> 'open' then
    raise exception 'Смена не открыта';
  end if;
  select * into v_reason from pos_cash_reasons where id = p_reason and is_active;
  if not found then
    raise exception 'Выберите причину';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Укажите сумму';
  end if;
  if v_reason.kind = 'salary' and p_paid_employee is null then
    raise exception 'Выберите, кому зарплата';
  end if;
  if v_reason.direction = 'out' and round(p_amount, 2) > pos_shift_expected_cash(p_shift) then
    raise exception 'В кассе по учёту меньше, чем вы забираете. Проверьте сумму или сначала внесите деньги';
  end if;

  insert into pos_cash_movements
    (id, shift_id, direction, reason_id, amount, employee_id, staff_id, paid_employee_id, comment, device_id)
  values
    (coalesce(p_id, gen_random_uuid()), p_shift, v_reason.direction, p_reason, round(p_amount, 2),
     p_employee, p_staff, p_paid_employee, nullif(trim(coalesce(p_comment, '')), ''), p_device)
  returning id into p_id;

  return p_id;
end;
$$;

-- ================================================================
-- Функции: витрина
-- ================================================================

-- Собрать букет на витрину: цветы списываются документом сборки сразу,
-- при продаже со склада уже ничего не списывается.
create or replace function pos_assemble_bouquet(
  p_bouquet jsonb, p_items jsonb, p_location uuid, p_staff uuid, p_employee uuid)
returns uuid
language plpgsql
as $$
declare
  v_id     uuid := nullif(p_bouquet->>'id', '')::uuid;
  v_title  text := nullif(trim(coalesce(p_bouquet->>'title', '')), '');
  v_price  numeric := nullif(p_bouquet->>'price', '')::numeric;
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
    raise exception 'Добавьте в букет цветы — без состава на витрину не ставим';
  end if;

  insert into inv_documents (doc_type, location_id, created_by, employee_id, comment, device_id)
  values ('assembly', p_location, p_staff, p_employee,
          'Букет на витрину: ' || coalesce(v_title, 'без названия'), nullif(p_bouquet->>'device_id', ''))
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
     assembly_doc_id, cost, comment, device_id)
  values
    (coalesce(v_id, gen_random_uuid()), p_location, coalesce(v_title, 'Букет'), round(v_price, 2), 'vitrine', true,
     coalesce(array(select jsonb_array_elements_text(coalesce(p_bouquet->'photo_urls', '[]'::jsonb))), '{}'),
     p_employee, p_staff, v_doc, v_cost,
     nullif(trim(coalesce(p_bouquet->>'comment', '')), ''), nullif(p_bouquet->>'device_id', ''))
  returning id into v_id;

  insert into pos_bouquet_items (bouquet_id, item_id, qty)
  select v_id, item_id, qty_delta * -1 from inv_document_lines where document_id = v_doc;

  return v_id;
end;
$$;

-- Разобрать: цветы возвращаются на склад по той цене, по которой ушли в
-- букет, — себестоимость не плывёт от того, что букет постоял.
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
  if v_b.status <> 'vitrine' then
    raise exception 'Букет уже не на витрине';
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

-- Списать завявший букет. Цветы уже ушли со склада при сборке, поэтому
-- движения склада нет — потеря видна как себестоимость списанного букета.
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
  if v_b.status <> 'vitrine' then
    raise exception 'Букет уже не на витрине';
  end if;

  update pos_bouquets
     set status = 'written_off', closed_at = now(), closed_by = p_employee,
         writeoff_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Завял')
   where id = p_bouquet;
end;
$$;

-- ================================================================
-- Функции: продажа
-- ================================================================

-- Одна продажа — одна транзакция: чек, строки, оплаты, букеты и документ
-- склада появляются вместе или не появляются вовсе. Идентификатор чека
-- создаёт устройство, поэтому повторная отправка (пропала связь на
-- ответе) не продаст букет дважды.
--
-- p_sale:     { id, shift_id, customer_id?, discount_percent?, approved_by?,
--               comment?, device_id? }
-- p_lines:    [ { kind: 'bouquet', id?, title?, price, items: [{item_id, qty}] }
--             | { kind: 'vitrine', bouquet_id }
--             | { kind: 'item', item_id, qty, price } ]
-- p_payments: [ { method, amount } ]
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
  v_pay        jsonb;
  v_seen       uuid[] := '{}';
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

      else
        raise exception 'Строка %: непонятный вид строки', i;
    end case;
  end loop;

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
    (v_id, v_no, v_shift.location_id, v_shift.id, nullif(p_sale->>'customer_id', '')::uuid, p_employee, p_staff,
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
    end case;
  end loop;

  insert into pos_payments (sale_id, method, amount)
  select v_id, value->>'method', round((value->>'amount')::numeric, 2)
    from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb));

  return jsonb_build_object('id', v_id, 'sale_no', v_no, 'repeated', false);
end;
$$;

comment on function pos_record_sale(jsonb, jsonb, jsonb, uuid, uuid) is
  'Продажа одной транзакцией: чек, строки, оплаты, букеты, документ склада. Идемпотентна по id чека.';

-- ================================================================
-- Доступ
-- ================================================================

alter table hr_employees         enable row level security;
alter table pos_settings         enable row level security;
alter table pos_payment_methods  enable row level security;
alter table pos_cash_reasons     enable row level security;
alter table pos_shifts           enable row level security;
alter table pos_cash_movements   enable row level security;
alter table pos_bouquets         enable row level security;
alter table pos_bouquet_items    enable row level security;
alter table pos_sales            enable row level security;
alter table pos_sale_lines       enable row level security;
alter table pos_payments         enable row level security;

revoke all on table
  hr_employees, pos_settings, pos_payment_methods, pos_cash_reasons, pos_shifts, pos_cash_movements,
  pos_bouquets, pos_bouquet_items, pos_sales, pos_sale_lines, pos_payments, inv_item_freshness
from anon, authenticated;

grant all on table
  hr_employees, pos_settings, pos_payment_methods, pos_cash_reasons, pos_shifts, pos_cash_movements,
  pos_bouquets, pos_bouquet_items, pos_sales, pos_sale_lines, pos_payments
to service_role;

grant select on inv_item_freshness to service_role;

revoke execute on function inv_next_doc_no(text)                                        from public, anon, authenticated;
revoke execute on function inv_post_document(uuid, uuid)                                 from public, anon, authenticated;
revoke execute on function inv_reverse_document(uuid, uuid, text)                        from public, anon, authenticated;
revoke execute on function pos_shift_expected_cash(uuid)                                 from public, anon, authenticated;
revoke execute on function pos_open_shift(uuid, uuid, numeric, uuid, uuid, text)         from public, anon, authenticated;
revoke execute on function pos_close_shift(uuid, numeric, uuid, uuid, text)              from public, anon, authenticated;
revoke execute on function pos_cash_move(uuid, uuid, uuid, numeric, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function pos_assemble_bouquet(jsonb, jsonb, uuid, uuid, uuid)          from public, anon, authenticated;
revoke execute on function pos_disassemble_bouquet(uuid, uuid, uuid)                     from public, anon, authenticated;
revoke execute on function pos_writeoff_bouquet(uuid, uuid, uuid, text)                  from public, anon, authenticated;
revoke execute on function pos_record_sale(jsonb, jsonb, jsonb, uuid, uuid)              from public, anon, authenticated;
revoke execute on function pos_cash_movements_guard()                                    from public, anon, authenticated;
revoke execute on function pos_bouquets_guard()                                          from public, anon, authenticated;
revoke execute on function pos_sales_guard()                                             from public, anon, authenticated;
revoke execute on function pos_sale_children_guard()                                     from public, anon, authenticated;

grant execute on function inv_next_doc_no(text)                                        to service_role;
grant execute on function inv_post_document(uuid, uuid)                                 to service_role;
grant execute on function inv_reverse_document(uuid, uuid, text)                        to service_role;
grant execute on function pos_shift_expected_cash(uuid)                                 to service_role;
grant execute on function pos_open_shift(uuid, uuid, numeric, uuid, uuid, text)         to service_role;
grant execute on function pos_close_shift(uuid, numeric, uuid, uuid, text)              to service_role;
grant execute on function pos_cash_move(uuid, uuid, uuid, numeric, uuid, uuid, uuid, text, text) to service_role;
grant execute on function pos_assemble_bouquet(jsonb, jsonb, uuid, uuid, uuid)          to service_role;
grant execute on function pos_disassemble_bouquet(uuid, uuid, uuid)                     to service_role;
grant execute on function pos_writeoff_bouquet(uuid, uuid, uuid, text)                  to service_role;
grant execute on function pos_record_sale(jsonb, jsonb, jsonb, uuid, uuid)              to service_role;

commit;
