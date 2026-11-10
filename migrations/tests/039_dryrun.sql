-- Прогон 039_uchet_recipes.sql вместе с тестом в одной транзакции, с откатом.
-- Проверяет миграцию на боевой базе до того, как её применить. Сгенерирован scratch-скриптом.
begin;
-- ================================================================
-- 039. Рецепты букетов, отложенные чеки, маленькое название букета на сайте.
--
-- Рецепт — это букет, который собирают снова и снова: состав, фото и цена.
-- Цена по составу считается от цен цветов на складе, поэтому меняется
-- вместе с ними; можно поставить и свою. Из рецепта флорист продаёт букет
-- или собирает его на витрину в одно касание. Рецепт может быть связан с
-- букетом на сайте: тогда название, цену и состав на сайте обновляют из
-- рецепта, а не руками в двух местах.
--
-- Отложенный чек раньше жил только на айпаде, где его отложили: второй
-- айпад и владелец не видели, что цветы уже кому-то обещаны. Теперь он
-- записывается сюда, и касса показывает на плитке, сколько отложено.
-- Это черновик, а не учётный документ: остаток он не меняет, после
-- оплаты или возврата в чек строка удаляется, а забытая через сутки
-- перестаёт учитываться.
--
-- nickname у товара сайта — короткое название букета («Солнышко»),
-- которое показывается мелко рядом с основным «Букет из …».
-- ================================================================


-- ---------------------------------------------------------------
-- Маленькое название букета на сайте
-- ---------------------------------------------------------------

alter table products add column if not exists nickname text;
alter table products drop constraint if exists products_nickname_len;
alter table products add constraint products_nickname_len
  check (nickname is null or char_length(btrim(nickname)) between 1 and 60);

comment on column products.nickname is
  'Короткое название букета, показывается мелко рядом с основным: «Солнышко». NULL — нет.';

-- ---------------------------------------------------------------
-- Рецепты
-- ---------------------------------------------------------------

create table if not exists pos_recipes (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(btrim(title)) between 1 and 160),
  nickname           text check (nickname is null or char_length(btrim(nickname)) between 1 and 60),
  photo_url          text,
  price_mode         text not null default 'composition' check (price_mode in ('composition', 'fixed')),
  fixed_price        numeric(12,2) check (fixed_price is null or fixed_price >= 0),
  -- Букет на сайте, который описывает этот рецепт.
  product_id         uuid references products(id) on delete set null,
  -- Откуда пришёл: спецификация Posiflora. Повторный импорт её не задвоит.
  posiflora_spec_id  text unique,
  -- Цена в Posiflora на момент импорта — для сверки, не для продажи.
  posiflora_price    numeric(12,2),
  is_active          boolean not null default true,
  sort               integer not null default 0,
  created_by         uuid references staff(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint pos_recipes_fixed_has_price check (price_mode <> 'fixed' or fixed_price is not null)
);

comment on table pos_recipes is 'Рецепты букетов: состав, фото, цена по составу или своя. Состав — pos_recipe_items.';

create index if not exists pos_recipes_active on pos_recipes (is_active, sort, title);
create index if not exists pos_recipes_product on pos_recipes (product_id);

create table if not exists pos_recipe_items (
  recipe_id  uuid not null references pos_recipes(id) on delete cascade,
  item_id    uuid not null references inv_items(id),
  qty        numeric(12,3) not null check (qty > 0),
  sort       integer not null default 0,
  primary key (recipe_id, item_id)
);

drop trigger if exists pos_recipes_updated on pos_recipes;
create trigger pos_recipes_updated before update on pos_recipes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- Отложенные чеки
-- ---------------------------------------------------------------

create table if not exists pos_held_checks (
  -- Тот же id, под которым чек потом станет продажей.
  id           uuid primary key,
  location_id  uuid not null references inv_locations(id),
  title        text not null,
  total        numeric(12,2) not null default 0 check (total >= 0),
  -- Что отложено: [{"item_id": "…", "qty": 3}] — цветы букетов и позиции чека.
  items        jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  employee_id  uuid references hr_employees(id) on delete set null,
  staff_id     uuid references staff(id) on delete set null,
  device_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table pos_held_checks is 'Отложенные чеки кассы: что обещано покупателю, но ещё не оплачено. Черновик, остаток не меняет.';

create index if not exists pos_held_checks_location on pos_held_checks (location_id, updated_at);

drop trigger if exists pos_held_checks_updated on pos_held_checks;
create trigger pos_held_checks_updated before update on pos_held_checks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- Доступ: как у остальных таблиц кассы — только сервер.
-- ---------------------------------------------------------------

alter table pos_recipes      enable row level security;
alter table pos_recipe_items enable row level security;
alter table pos_held_checks  enable row level security;

revoke all on table pos_recipes, pos_recipe_items, pos_held_checks from anon, authenticated;
grant all on table pos_recipes, pos_recipe_items, pos_held_checks to service_role;


-- ================================================================
-- Проверка миграции 039 (рецепты, отложенные чеки, nickname). Откатывается.
-- ================================================================

do $$
declare
  v_item uuid;
  v_loc  uuid;
  v_rec  uuid;
  v_prod uuid;
begin
  select id into v_item from inv_items order by created_at limit 1;
  select id into v_loc from inv_locations order by created_at limit 1;
  select id into v_prod from products order by created_at limit 1;
  if v_item is null or v_loc is null or v_prod is null then raise exception 'Нет данных для проверки'; end if;

  -- 1. Рецепт с составом и связью с букетом сайта
  insert into pos_recipes (title, product_id) values ('Проверка 039', v_prod) returning id into v_rec;
  insert into pos_recipe_items (recipe_id, item_id, qty) values (v_rec, v_item, 3);
  if (select count(*) from pos_recipe_items where recipe_id = v_rec) <> 1 then raise exception 'Состав не сохранился'; end if;
  raise notice '1. Рецепт и состав сохраняются';

  -- 2. Своя цена обязательна для режима fixed
  begin
    update pos_recipes set price_mode = 'fixed', fixed_price = null where id = v_rec;
    raise exception 'Пропущена своя цена без суммы';
  exception when check_violation then raise notice '2. Своя цена без суммы отклонена'; end;

  -- 3. Количество больше нуля
  begin
    update pos_recipe_items set qty = 0 where recipe_id = v_rec;
    raise exception 'Пропущено нулевое количество';
  exception when check_violation then raise notice '3. Нулевое количество отклонено'; end;

  -- 4. Пустое название не проходит
  begin
    insert into pos_recipes (title) values ('   ');
    raise exception 'Пропущено пустое название';
  exception when check_violation then raise notice '4. Пустое название отклонено'; end;

  -- 5. Повторный импорт той же спецификации не задвоит рецепт
  update pos_recipes set posiflora_spec_id = 'spec-test-039' where id = v_rec;
  begin
    insert into pos_recipes (title, posiflora_spec_id) values ('Дубль', 'spec-test-039');
    raise exception 'Задвоилась спецификация';
  exception when unique_violation then raise notice '5. Спецификация не задваивается'; end;

  -- 6. Удаление рецепта забирает и состав (рецепты скрывают, но черновик удалить можно)
  delete from pos_recipes where id = v_rec;
  if exists (select 1 from pos_recipe_items where recipe_id = v_rec) then raise exception 'Состав остался без рецепта'; end if;
  raise notice '6. Состав уходит вместе с рецептом';

  -- 7. Отложенный чек: список позиций обязан быть массивом
  insert into pos_held_checks (id, location_id, title, total, items)
  values (gen_random_uuid(), v_loc, 'Букет 1', 1500, jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 5)));
  begin
    insert into pos_held_checks (id, location_id, title, items) values (gen_random_uuid(), v_loc, 'Ошибка', '{}'::jsonb);
    raise exception 'Пропущен не-массив';
  exception when check_violation then raise notice '7. Отложенный чек хранит список позиций'; end;

  -- 8. Маленькое название букета: длина и пустота
  update products set nickname = 'Солнышко' where id = v_prod;
  begin
    update products set nickname = '  ' where id = v_prod;
    raise exception 'Пропущено пустое маленькое название';
  exception when check_violation then raise notice '8. Пустое маленькое название отклонено'; end;

  -- 9. Доступ: посетитель сайта читает nickname, но не видит рецепты и чеки
  if not has_column_privilege('anon', 'products', 'nickname', 'select') then raise exception 'Сайт не прочитает маленькое название'; end if;
  if has_table_privilege('anon', 'pos_recipes', 'select') or has_table_privilege('authenticated', 'pos_recipes', 'select') then raise exception 'Рецепты видны снаружи'; end if;
  if has_table_privilege('anon', 'pos_held_checks', 'select') or has_table_privilege('authenticated', 'pos_held_checks', 'insert') then raise exception 'Отложенные чеки доступны снаружи'; end if;
  if not has_table_privilege('service_role', 'pos_recipes', 'insert') then raise exception 'Сервер не может записать рецепт'; end if;
  raise notice '9. Доступ закрыт снаружи, сервер пишет';
end $$;

select 'ВСЕ ПРОВЕРКИ 039 ПРОШЛИ' as result;


rollback;
