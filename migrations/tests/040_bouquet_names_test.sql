-- ================================================================
-- Проверка миграции 040 (названия букетов). Откатывается.
-- Запускается после миграции в той же транзакции (см. 040_dryrun.sql).
-- ================================================================
begin;

do $$
declare
  v_n int;
begin
  -- 1. Маленькие названия не повторяются
  select count(*) into v_n from (
    select lower(replace(nickname, 'ё', 'е')) from products where nickname is not null group by 1 having count(*) > 1
  ) d;
  if v_n > 0 then raise exception 'Есть повторяющиеся маленькие названия: %', v_n; end if;
  raise notice '1. Маленькие названия не повторяются';

  -- 2. Во всех новых названиях нет второстепенного и обрывков HTML
  select count(*) into v_n from products p join _rename_040 r on r.id = p.id
  where p.name ~* '(эвкалип|ковыл|лагурус|элеукодендрон|стабилизир|хелеборус|хамелаци|дизайнерской упаковке|&#)';
  if v_n > 0 then raise exception 'Второстепенное осталось в % названиях', v_n; end if;
  raise notice '2. Второстепенного в названиях нет';

  -- 3. Прежнее название сохранено у каждого
  select count(*) into v_n from products p join _rename_040 r on r.id = p.id
  where p.attributes->'beforeRename'->>'name' is distinct from r.old_name;
  if v_n > 0 then raise exception 'Не сохранено прежнее название у %', v_n; end if;
  raise notice '3. Прежние названия сохранены';

  -- 4. Откат из комментария миграции возвращает всё как было
  update products set name = attributes->'beforeRename'->>'name', nickname = attributes->'beforeRename'->>'nickname'
  where id in (select id from _rename_040);
  select count(*) into v_n from products p join _rename_040 r on r.id = p.id
  where p.name <> r.old_name or p.nickname is not null;
  if v_n > 0 then raise exception 'Откат не вернул % букетов', v_n; end if;
  raise notice '4. Откат возвращает прежние названия';

  -- 5. Остальные товары не тронуты
  select count(*) into v_n from products where attributes ? 'beforeRename' and id not in (select id from _rename_040);
  if v_n > 0 then raise exception 'Задеты лишние товары: %', v_n; end if;
  raise notice '5. Лишнего не задето';
end $$;

select 'ВСЕ ПРОВЕРКИ 040 ПРОШЛИ' as result;

rollback;
