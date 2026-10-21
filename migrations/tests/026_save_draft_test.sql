-- ================================================================
-- Проверка сохранения черновика (миграция 026). Транзакция откатывается.
-- ================================================================

\set ON_ERROR_STOP on

begin;

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

rollback;
