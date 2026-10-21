-- ================================================================
-- Проверка торгового зала (миграция 028). Транзакция откатывается:
-- в базе не остаётся ни смены, ни чека, ни букета.
--
-- Всё — на отдельном тестовом месте, чтобы не задеть ни «Тренировку»,
-- ни «Магазин»: в каждом месте может быть только одна открытая смена.
-- ================================================================

\set ON_ERROR_STOP on

begin;

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

rollback;
