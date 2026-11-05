-- Прогон 038_product_season.sql вместе с тестом в одной транзакции, с откатом.
-- Проверяет миграцию на боевой базе до того, как её применить. Сгенерирован scratch-скриптом.
begin;
-- ================================================================
-- 038. Сезон букета: в какие месяцы показывать его на сайте.
--
-- Цветы сезонные: пион продаётся с мая по начало июля, эустома с конца
-- июня по сентябрь. Раньше витрину меняли руками, а чаще не меняли вовсе:
-- в ноябре на сайте стояли тюльпаны и пионы. Теперь у букета можно отметить
-- месяцы. Вне их он сам исчезает из каталога, поиска и с главной, а через
-- год сам возвращается, и удалять ничего не нужно.
--
-- NULL — показывать весь год. Так у всех существующих букетов, поэтому
-- сама миграция на витрине ничего не меняет. Пустой массив не допускаем:
-- он читался бы как «никогда», а для этого есть «Скрыть».
-- ================================================================


alter table products add column if not exists season_months smallint[];

alter table products drop constraint if exists products_season_months_valid;
alter table products add constraint products_season_months_valid
  check (
    season_months is null
    or (
      cardinality(season_months) between 1 and 12
      and season_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]
    )
  );

comment on column products.season_months is
  'Месяцы (1–12), когда букет виден на сайте. NULL — весь год.';


-- ================================================================
-- Проверка миграции 038 (сезон букета). Откатывается.
-- ================================================================

do $$
declare
  v_id uuid;
  v_total int;
  v_visible int;
  v_null int;
begin
  select count(*) into v_total from products;
  select count(*) into v_null from products where season_months is null;
  if v_null <> v_total then raise exception 'Миграция изменила существующие букеты: % из %', v_null, v_total; end if;
  raise notice '1. Существующие букеты остались «весь год»: %', v_total;

  select id into v_id from products order by created_at limit 1;
  if v_id is null then raise exception 'Нет товаров для проверки'; end if;

  update products set season_months = array[5,6]::smallint[] where id = v_id;
  if (select season_months from products where id = v_id) <> array[5,6]::smallint[] then raise exception 'Месяцы не сохранились'; end if;
  raise notice '2. Месяцы сохраняются';

  begin
    update products set season_months = array[13]::smallint[] where id = v_id;
    raise exception 'Пропущен месяц 13';
  exception when check_violation then raise notice '3. Месяц 13 отклонён'; end;

  begin
    update products set season_months = array[0]::smallint[] where id = v_id;
    raise exception 'Пропущен месяц 0';
  exception when check_violation then raise notice '4. Месяц 0 отклонён'; end;

  begin
    update products set season_months = '{}'::smallint[] where id = v_id;
    raise exception 'Пропущен пустой список';
  exception when check_violation then raise notice '5. Пустой список отклонён'; end;

  -- Тот же отбор, что делает сайт: нет сезона или месяц входит в него.
  select count(*) into v_visible from products where id = v_id and (season_months is null or season_months @> array[11]::smallint[]);
  if v_visible <> 0 then raise exception 'В ноябре виден майский букет'; end if;
  select count(*) into v_visible from products where id = v_id and (season_months is null or season_months @> array[6]::smallint[]);
  if v_visible <> 1 then raise exception 'В июне не виден майско-июньский букет'; end if;
  raise notice '6. Отбор по месяцу работает';

  if not has_column_privilege('anon', 'products', 'season_months', 'select') then raise exception 'Посетитель не может читать сезон — каталог опустеет'; end if;
  if has_column_privilege('anon', 'products', 'season_months', 'update') then raise exception 'Посетитель может менять сезон'; end if;
  raise notice '7. Посетитель читает сезон и не может менять';
end $$;

select 'ВСЕ ПРОВЕРКИ 038 ПРОШЛИ' as result;


rollback;
