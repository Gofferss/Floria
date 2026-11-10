-- ================================================================
-- Проверка миграции 039 (рецепты, отложенные чеки, nickname). Откатывается.
-- ================================================================
begin;

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
