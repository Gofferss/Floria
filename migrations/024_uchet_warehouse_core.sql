-- ================================================================
-- Флория Учёт, этап 1: ядро склада.
--
-- Главное устройство — журнал. Остаток позиции НЕ хранится как число,
-- которое кто-то правит: он считается как сумма изменений по проведённым
-- документам. Таблица inv_stock — только кэш этой суммы, и пишет её одна
-- функция проведения. Представление inv_stock_check сравнивает кэш с
-- журналом и обязано быть пустым.
--
-- Отсюда три следствия, ради которых всё так и сделано:
--   * работа без интернета: устройство дописывает документы, а не правит
--     остатки, поэтому два планшета не затрут друг другу цифры;
--   * честность: проведённое не правится (это запрещено триггером), ошибку
--     исправляют сторно — новым документом с обратным знаком;
--   * себестоимость: каждый приход несёт цену, расход морозит среднюю на
--     момент проведения, и прибыль прошлого месяца не меняется от
--     сегодняшних закупок.
--
-- Безопасность. Все таблицы закрыты RLS без политик И лишены грантов для
-- anon/authenticated. Одного RLS мало: дефолтные гранты Supabase плюс
-- представление, исполняемое правами владельца, однажды уже дали дыру с
-- бонусами (см. 015). Функциям явно снят EXECUTE с public — по умолчанию
-- PostgreSQL выдаёт его всем, и через PostgREST их можно было бы вызвать
-- анонимно.
--
-- Документация: docs/uchet/README.md.
-- ================================================================

begin;

-- ================================================================
-- Справочники
-- ================================================================

create table if not exists inv_units (
  code         text primary key,
  title        text not null,
  short_title  text not null,
  fractional   boolean not null default false,
  sort         integer not null default 0
);

comment on table inv_units is 'Единицы измерения позиций склада.';

insert into inv_units (code, title, short_title, fractional, sort) values
  ('pcs',   'Штука',     'шт',   false, 10),
  ('stem',  'Ветка',     'вет',  false, 20),
  ('bunch', 'Пучок',     'пуч',  false, 30),
  ('m',     'Метр',      'м',    true,  40),
  ('sheet', 'Лист',      'лист', false, 50),
  ('kg',    'Килограмм', 'кг',   true,  60),
  ('pack',  'Упаковка',  'уп',   false, 70)
on conflict (code) do nothing;

create table if not exists inv_groups (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid references inv_groups(id) on delete set null,
  title         text not null,
  -- Вид нужен логике, а не красоте: свежесть считается только для
  -- цветов и зелени, услуги не ведутся по остаткам.
  kind          text not null default 'other'
                check (kind in ('flower','greenery','decor','packaging','gift','print','service','bouquet','other')),
  sort          integer not null default 0,
  is_active     boolean not null default true,
  posiflora_key text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (parent_id, title)
);

comment on table inv_groups is 'Группы позиций склада, до двух уровней. Редактируются владельцем.';
comment on column inv_groups.posiflora_key is 'Ключ сопоставления при импорте из Posiflora: «группа/категория».';

create table if not exists inv_locations (
  id          uuid primary key default gen_random_uuid(),
  title       text not null unique,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table inv_locations is 'Места хранения. Сейчас одно — магазин; таблица на случай второй точки.';

-- Ровно одно место по умолчанию.
create unique index if not exists inv_locations_one_default
  on inv_locations (is_default) where is_default;

insert into inv_locations (title, is_default)
select 'Магазин', true
where not exists (select 1 from inv_locations);

create table if not exists inv_suppliers (
  id          uuid primary key default gen_random_uuid(),
  title       text not null unique,
  phone       text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table inv_suppliers is 'Поставщики. Необязательны в приходе: закупка «по-разному».';

create table if not exists inv_writeoff_reasons (
  id          uuid primary key default gen_random_uuid(),
  title       text not null unique,
  sort        integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table inv_writeoff_reasons is 'Причины списания. Список редактирует владелец; в коде на них ничего не завязано.';

insert into inv_writeoff_reasons (title, sort) values
  ('Завяли',              10),
  ('Брак, сломались',     20),
  ('Недостача',           30),
  ('На нужды студии',     40),
  ('Для фото и витрины',  50),
  ('Подарок клиенту',     60),
  ('Другое',              90)
on conflict (title) do nothing;

-- ================================================================
-- Номенклатура
-- ================================================================

create table if not exists inv_items (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  group_id      uuid references inv_groups(id) on delete set null,
  unit_code     text not null default 'pcs' references inv_units(code),
  fractional    boolean not null default false,
  -- Услуги (доставка, упаковка как работа) по остаткам не ведутся.
  is_tracked    boolean not null default true,
  sale_price    numeric(12,2) check (sale_price is null or sale_price >= 0),
  min_qty       numeric(12,3) check (min_qty is null or min_qty >= 0),
  fresh_days    integer check (fresh_days is null or fresh_days > 0),
  barcode       text,
  photo_url     text,
  notes         text,
  is_active     boolean not null default true,
  posiflora_id  text unique,
  -- Кэш скользящей средней себестоимости. Пишет только проведение.
  avg_cost      numeric(14,4) not null default 0 check (avg_cost >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table inv_items is 'Позиции склада: цветы, зелень, упаковка, подарки, услуги.';
comment on column inv_items.avg_cost is 'Скользящая средняя себестоимость за единицу. Только для владельцев.';
comment on column inv_items.fresh_days is 'Сколько дней позиция живёт; по нему подсвечивается возраст остатка.';

create index if not exists inv_items_title_trgm on inv_items using gin (title gin_trgm_ops);
create index if not exists inv_items_group on inv_items (group_id);

-- ================================================================
-- Документы и журнал
-- ================================================================

create table if not exists inv_doc_counters (
  doc_type  text primary key,
  last_no   integer not null default 0
);

create table if not exists inv_documents (
  -- Без default на стороне устройства: для работы без сети планшет сам
  -- создаёт идентификатор, и повторная отправка того же документа
  -- распознаётся по нему. Серверный default — для документов из админки.
  id                  uuid primary key default gen_random_uuid(),
  doc_type            text not null
                      check (doc_type in ('opening','receipt','writeoff','inventory','assembly','sale','return')),
  doc_no              text not null unique,
  status              text not null default 'draft'
                      check (status in ('draft','posted','reversed')),
  location_id         uuid not null references inv_locations(id),
  doc_date            timestamptz not null default now(),
  supplier_id         uuid references inv_suppliers(id) on delete set null,
  writeoff_reason_id  uuid references inv_writeoff_reasons(id) on delete set null,
  payment_method      text check (payment_method in ('cash','card','transfer','unpaid','other')),
  total_cost          numeric(14,2) not null default 0,
  comment             text,
  reversal_of         uuid references inv_documents(id),
  created_by          uuid references staff(id) on delete set null,
  posted_by           uuid references staff(id) on delete set null,
  posted_at           timestamptz,
  device_id           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table inv_documents is 'Документы склада. Проведённые не правятся; исправление — сторно.';
comment on column inv_documents.total_cost is 'Сумма документа по себестоимости (по модулю строк), для отображения.';
comment on column inv_documents.reversal_of is 'Если заполнено — это сторно указанного документа.';

create index if not exists inv_documents_type_date on inv_documents (doc_type, doc_date desc);
create index if not exists inv_documents_status on inv_documents (status);

create table if not exists inv_document_lines (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references inv_documents(id) on delete cascade,
  item_id       uuid not null references inv_items(id),
  -- То, что ввёл человек: пришло 50, списали 3, насчитали 47.
  qty           numeric(12,3) not null check (qty >= 0),
  -- Изменение остатка со знаком. Пишет проведение.
  qty_delta     numeric(12,3),
  unit_cost     numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  -- qty_delta × unit_cost, со знаком: приход +, расход −.
  amount        numeric(14,2),
  -- Для инвентаризации: сколько числилось по учёту в момент проведения.
  stock_before  numeric(12,3),
  sort          integer not null default 0,
  created_at    timestamptz not null default now()
);

comment on table inv_document_lines is 'Строки документов — это и есть журнал движений склада.';

create index if not exists inv_document_lines_doc on inv_document_lines (document_id);
create index if not exists inv_document_lines_item on inv_document_lines (item_id);

create table if not exists inv_stock (
  item_id      uuid not null references inv_items(id) on delete cascade,
  location_id  uuid not null references inv_locations(id) on delete cascade,
  qty          numeric(12,3) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (item_id, location_id)
);

comment on table inv_stock is 'КЭШ остатков. Пишет только inv_post_document / inv_reverse_document. Сверка — inv_stock_check.';

create table if not exists inv_posiflora_snapshot (
  item_id     uuid primary key references inv_items(id) on delete cascade,
  qty         numeric(12,3) not null,
  taken_at    timestamptz not null default now()
);

comment on table inv_posiflora_snapshot is
  'Последний снимок остатка позиции в Posiflora. Нужен для сверки, пока Posiflora — источник правды, и для начального остатка в день перехода.';

-- ================================================================
-- Служебные триггеры
-- ================================================================

drop trigger if exists inv_groups_updated on inv_groups;
create trigger inv_groups_updated before update on inv_groups
  for each row execute function set_updated_at();

drop trigger if exists inv_suppliers_updated on inv_suppliers;
create trigger inv_suppliers_updated before update on inv_suppliers
  for each row execute function set_updated_at();

drop trigger if exists inv_items_updated on inv_items;
create trigger inv_items_updated before update on inv_items
  for each row execute function set_updated_at();

drop trigger if exists inv_documents_updated on inv_documents;
create trigger inv_documents_updated before update on inv_documents
  for each row execute function set_updated_at();

-- Номер документа: «ПР-0001». Отдельный счётчик на каждый тип.
create or replace function inv_next_doc_no(p_type text)
returns text
language plpgsql
as $$
declare
  n integer;
  prefix text := case p_type
    when 'opening'   then 'НО'
    when 'receipt'   then 'ПР'
    when 'writeoff'  then 'СП'
    when 'inventory' then 'ИН'
    when 'assembly'  then 'СБ'
    when 'sale'      then 'ПД'
    when 'return'    then 'ВЗ'
    else 'ДК'
  end;
begin
  insert into inv_doc_counters (doc_type, last_no) values (p_type, 1)
  on conflict (doc_type) do update set last_no = inv_doc_counters.last_no + 1
  returning last_no into n;
  return prefix || '-' || lpad(n::text, 4, '0');
end;
$$;

create or replace function inv_documents_number()
returns trigger
language plpgsql
as $$
begin
  if new.doc_no is null or new.doc_no = '' then
    new.doc_no := inv_next_doc_no(new.doc_type);
  end if;
  return new;
end;
$$;

drop trigger if exists inv_documents_number on inv_documents;
create trigger inv_documents_number before insert on inv_documents
  for each row execute function inv_documents_number();

-- Проведённый документ не правится. Разрешены только перевод
-- «проведён → сторнирован» (его делает функция сторно) и комментарий.
create or replace function inv_documents_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Документ % проведён — удалить нельзя, только сторно', old.doc_no;
    end if;
    return old;
  end if;

  if old.status = 'draft' then
    return new;
  end if;

  if old.status = 'reversed' then
    if new.status is distinct from old.status
       or new.doc_type is distinct from old.doc_type
       or new.location_id is distinct from old.location_id
       or new.doc_date is distinct from old.doc_date
       or new.total_cost is distinct from old.total_cost then
      raise exception 'Документ % сторнирован и больше не меняется', old.doc_no;
    end if;
    return new;
  end if;

  -- old.status = 'posted'
  if new.status not in ('posted', 'reversed')
     or new.doc_type is distinct from old.doc_type
     or new.location_id is distinct from old.location_id
     or new.doc_date is distinct from old.doc_date
     or new.supplier_id is distinct from old.supplier_id
     or new.writeoff_reason_id is distinct from old.writeoff_reason_id
     or new.payment_method is distinct from old.payment_method
     or new.total_cost is distinct from old.total_cost
     or new.reversal_of is distinct from old.reversal_of then
    raise exception 'Документ % проведён — менять можно только комментарий, остальное через сторно', old.doc_no;
  end if;
  return new;
end;
$$;

drop trigger if exists inv_documents_guard on inv_documents;
create trigger inv_documents_guard before update or delete on inv_documents
  for each row execute function inv_documents_guard();

-- Строки проведённого документа не меняются и не удаляются. Это главная
-- гарантия честности журнала: исправить прошлое можно только новой
-- записью, а не тихо.
create or replace function inv_lines_guard()
returns trigger
language plpgsql
as $$
declare
  st text;
begin
  select status into st from inv_documents
   where id = coalesce(new.document_id, old.document_id);

  -- Строки удаляются каскадом вместе с документом-черновиком; при
  -- удалении самого документа его строки уже не найти — пропускаем.
  if st is null then
    return coalesce(new, old);
  end if;

  if st <> 'draft' then
    raise exception 'Документ уже проведён — строки менять нельзя, только сторно';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists inv_lines_guard on inv_document_lines;
create trigger inv_lines_guard before insert or update or delete on inv_document_lines
  for each row execute function inv_lines_guard();

-- ================================================================
-- Проведение
-- ================================================================

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
  if d.doc_type not in ('opening','receipt','writeoff','inventory') then
    raise exception 'Проведение документов типа «%» пока не поддерживается', d.doc_type;
  end if;

  -- Позиции блокируем в одном порядке: две одновременные проводки с
  -- общими позициями иначе могли бы сцепиться намертво.
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

    if d.doc_type in ('opening', 'receipt') then
      if l.qty = 0 then
        raise exception 'Строка %: укажите количество', n;
      end if;
      if d.doc_type = 'receipt' and l.unit_cost is null then
        raise exception 'Строка %: в приходе нужна цена закупки', n;
      end if;

      delta := l.qty;
      cost := coalesce(l.unit_cost, cur_avg);

      -- Отрицательный остаток в среднюю не входит: иначе приход на
      -- «минус» давал бы бессмысленную, даже отрицательную среднюю.
      base_qty := greatest(cur_qty, 0);
      if base_qty + delta > 0 then
        new_avg := (base_qty * cur_avg + delta * cost) / (base_qty + delta);
        update inv_items set avg_cost = round(new_avg, 4) where id = l.item_id;
      end if;

    elsif d.doc_type = 'writeoff' then
      if l.qty = 0 then
        raise exception 'Строка %: укажите количество', n;
      end if;
      delta := -l.qty;
      cost := cur_avg;

    elsif d.doc_type = 'inventory' then
      -- В инвентаризации человек вводит, сколько НАСЧИТАЛ. Изменение —
      -- разница с учётом. Средняя при этом не меняется: излишек входит
      -- по текущей средней, недостача уходит по ней же.
      delta := l.qty - cur_qty;
      cost := cur_avg;
      update inv_document_lines set stock_before = cur_qty where id = l.id;
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

comment on function inv_post_document(uuid, uuid) is
  'Проводит черновик атомарно: изменения остатка, заморозка цен, пересчёт средней, кэш остатков.';

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

    -- Отменяем вклад прихода в среднюю. Если часть товара уже израсходована,
    -- честно «вычесть» приход из средней иногда нельзя — выходит
    -- отрицательная или бессмысленная цена. Тогда средняя остаётся как
    -- была: это ошибка в копейках на остатке, а не сломанный учёт.
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

comment on function inv_reverse_document(uuid, uuid, text) is
  'Сторно проведённого документа: новый документ с обратным знаком; исходный помечается reversed.';

-- ================================================================
-- Представления
-- ================================================================

-- Возраст самой старой партии в остатке, по FIFO. Цветы уходят в работу в
-- порядке поступления, поэтому «самое старое, что ещё лежит» — это первая
-- партия, которую не покрыли более свежие поступления.
create or replace view inv_item_freshness
with (security_invoker = on)
as
with incoming as (
  select l.item_id, d.location_id, d.doc_date, l.qty_delta as q
    from inv_document_lines l
    join inv_documents d on d.id = l.document_id
   where d.status = 'posted'
     and d.reversal_of is null
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

comment on view inv_item_freshness is 'Сколько дней лежит самая старая партия в остатке (FIFO).';

-- Расхождения кэша остатков с журналом. В норме пусто.
create or replace view inv_stock_check
with (security_invoker = on)
as
with ledger as (
  select d.location_id, l.item_id, sum(l.qty_delta) as qty
    from inv_document_lines l
    join inv_documents d on d.id = l.document_id
   where d.status in ('posted', 'reversed')
   group by d.location_id, l.item_id
)
select coalesce(s.item_id, g.item_id)          as item_id,
       coalesce(s.location_id, g.location_id)  as location_id,
       coalesce(s.qty, 0)                      as cached_qty,
       coalesce(g.qty, 0)                      as ledger_qty
  from inv_stock s
  full join ledger g on g.item_id = s.item_id and g.location_id = s.location_id
 where coalesce(s.qty, 0) <> coalesce(g.qty, 0);

comment on view inv_stock_check is 'Расхождения кэша остатков с журналом. Должно быть пусто; строки — признак записи в обход проведения.';

-- ================================================================
-- Доступ
-- ================================================================

alter table inv_units              enable row level security;
alter table inv_groups             enable row level security;
alter table inv_locations          enable row level security;
alter table inv_suppliers          enable row level security;
alter table inv_writeoff_reasons   enable row level security;
alter table inv_items              enable row level security;
alter table inv_doc_counters       enable row level security;
alter table inv_documents          enable row level security;
alter table inv_document_lines     enable row level security;
alter table inv_stock              enable row level security;
alter table inv_posiflora_snapshot enable row level security;

revoke all on table
  inv_units, inv_groups, inv_locations, inv_suppliers, inv_writeoff_reasons,
  inv_items, inv_doc_counters, inv_documents, inv_document_lines, inv_stock,
  inv_posiflora_snapshot, inv_item_freshness, inv_stock_check
from anon, authenticated;

grant all on table
  inv_units, inv_groups, inv_locations, inv_suppliers, inv_writeoff_reasons,
  inv_items, inv_doc_counters, inv_documents, inv_document_lines, inv_stock,
  inv_posiflora_snapshot
to service_role;

grant select on inv_item_freshness, inv_stock_check to service_role;

revoke execute on function inv_next_doc_no(text)                   from public, anon, authenticated;
revoke execute on function inv_post_document(uuid, uuid)            from public, anon, authenticated;
revoke execute on function inv_reverse_document(uuid, uuid, text)   from public, anon, authenticated;

grant execute on function inv_next_doc_no(text)                     to service_role;
grant execute on function inv_post_document(uuid, uuid)              to service_role;
grant execute on function inv_reverse_document(uuid, uuid, text)     to service_role;

commit;
