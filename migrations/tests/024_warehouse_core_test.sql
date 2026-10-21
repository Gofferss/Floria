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

\set ON_ERROR_STOP on

begin;

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

rollback;
