-- ================================================================
-- Сохранение черновика документа одной транзакцией.
--
-- Заголовок и строки пишутся вместе: иначе сбой между двумя запросами
-- оставил бы черновик без строк, и человек увидел бы пустой приход.
--
-- Эта же функция — будущая точка входа для планшета без сети. Устройство
-- создаёт идентификатор документа само и присылает его. Если такой
-- черновик уже есть — он перезаписывается целиком, а не появляется второй.
-- Поэтому повторная отправка из очереди безопасна: тот же документ
-- приходит, тот же документ и остаётся.
-- ================================================================

begin;

create or replace function inv_save_draft(p_doc jsonb, p_lines jsonb, p_staff uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_id       uuid := nullif(p_doc->>'id', '')::uuid;
  v_type     text := p_doc->>'doc_type';
  v_loc      uuid;
  existing   inv_documents%rowtype;
  is_update  boolean := false;
  line       jsonb;
  i          integer := 0;
begin
  if v_type is null or v_type not in ('opening', 'receipt', 'writeoff', 'inventory') then
    raise exception 'Неизвестный тип документа: %', coalesce(v_type, 'не указан');
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Строки документа должны быть списком';
  end if;

  select id into v_loc from inv_locations where is_default;
  if v_loc is null then
    raise exception 'Не задано место хранения по умолчанию';
  end if;

  if v_id is not null then
    select * into existing from inv_documents where id = v_id for update;
    is_update := found;
  end if;

  if is_update then
    if existing.status <> 'draft' then
      raise exception 'Документ % уже проведён — изменить нельзя, только сторно', existing.doc_no;
    end if;
    if existing.doc_type <> v_type then
      raise exception 'Тип документа менять нельзя';
    end if;

    update inv_documents
       set doc_date           = coalesce((p_doc->>'doc_date')::timestamptz, doc_date),
           supplier_id        = nullif(p_doc->>'supplier_id', '')::uuid,
           writeoff_reason_id = nullif(p_doc->>'writeoff_reason_id', '')::uuid,
           payment_method     = nullif(p_doc->>'payment_method', ''),
           comment            = nullif(trim(coalesce(p_doc->>'comment', '')), '')
     where id = v_id;

    delete from inv_document_lines where document_id = v_id;
  else
    insert into inv_documents
      (id, doc_type, location_id, doc_date, supplier_id, writeoff_reason_id,
       payment_method, comment, created_by, device_id)
    values
      (coalesce(v_id, gen_random_uuid()), v_type, v_loc,
       coalesce((p_doc->>'doc_date')::timestamptz, now()),
       nullif(p_doc->>'supplier_id', '')::uuid,
       nullif(p_doc->>'writeoff_reason_id', '')::uuid,
       nullif(p_doc->>'payment_method', ''),
       nullif(trim(coalesce(p_doc->>'comment', '')), ''),
       p_staff,
       nullif(p_doc->>'device_id', ''))
    returning id into v_id;
  end if;

  for line in select value from jsonb_array_elements(p_lines) loop
    i := i + 1;
    if nullif(line->>'item_id', '') is null then
      raise exception 'Строка %: не выбрана позиция', i;
    end if;
    if nullif(line->>'qty', '') is null then
      raise exception 'Строка %: не указано количество', i;
    end if;
    if (line->>'qty')::numeric < 0 then
      raise exception 'Строка %: количество не может быть отрицательным', i;
    end if;

    insert into inv_document_lines (document_id, item_id, qty, unit_cost, sort)
    values (v_id,
            (line->>'item_id')::uuid,
            (line->>'qty')::numeric,
            nullif(line->>'unit_cost', '')::numeric,
            i);
  end loop;

  return v_id;
end;
$$;

comment on function inv_save_draft(jsonb, jsonb, uuid) is
  'Создаёт или целиком перезаписывает черновик (заголовок + строки) одной транзакцией. Идемпотентна по id документа.';

revoke execute on function inv_save_draft(jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function inv_save_draft(jsonb, jsonb, uuid) to service_role;

commit;
