-- ================================================================
-- Тренировочный режим склада.
--
-- Пока продажи идут через Posiflora, у нашего склада нет начального
-- остатка: настоящий журнал начнётся с пересчёта в день запуска. Но
-- пробовать приложение, учиться и показывать флористам нужно уже сейчас.
-- Если такие пробы попадут в настоящий журнал, их оттуда не убрать —
-- проведённое не удаляется.
--
-- Поэтому места хранения два. «Тренировка» — место по умолчанию, пока
-- учёт не запущен: все документы попадают туда. В день запуска владелец
-- делает местом по умолчанию «Магазин», и настоящий журнал начинается с
-- чистого листа. Тренировочные документы остаются в истории отдельно.
-- ================================================================

begin;

alter table inv_locations
  add column if not exists is_training boolean not null default false;

comment on column inv_locations.is_training is
  'Тренировочное место: документы там не считаются настоящим учётом.';

insert into inv_locations (title, is_default, is_training)
select 'Тренировка', false, true
where not exists (select 1 from inv_locations where is_training);

-- Пока учёт не запущен — по умолчанию тренировка. Сначала снимаем флаг со
-- всех: уникальный индекс не даст двум местам быть основными одновременно.
do $$
begin
  if not exists (
    select 1 from inv_documents d
      join inv_locations l on l.id = d.location_id
     where not l.is_training
  ) then
    update inv_locations set is_default = false where is_default;
    update inv_locations set is_default = true where is_training;
  end if;
end;
$$;

-- Переключение места по умолчанию — одной транзакцией, иначе между двумя
-- обновлениями мест по умолчанию не было бы ни одного (или было бы два).
create or replace function inv_set_default_location(p_location uuid)
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from inv_locations where id = p_location and is_active) then
    raise exception 'Место хранения не найдено или выключено';
  end if;
  update inv_locations set is_default = false where is_default and id <> p_location;
  update inv_locations set is_default = true where id = p_location;
end;
$$;

comment on function inv_set_default_location(uuid) is
  'Делает место хранения основным. Запуск учёта — переключение с «Тренировки» на «Магазин».';

revoke execute on function inv_set_default_location(uuid) from public, anon, authenticated;
grant execute on function inv_set_default_location(uuid) to service_role;

commit;
