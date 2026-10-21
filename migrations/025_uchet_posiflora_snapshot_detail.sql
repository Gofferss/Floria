-- ================================================================
-- Снимок Posiflora: себестоимость и «жива ли позиция».
--
-- В движениях склада Posiflora есть не только количество, но и сумма —
-- по ней видна себестоимость единицы. А дата последнего движения
-- отвечает на вопрос, который важнее остатка: какие из 646 позиций вообще
-- живые. Большая часть номенклатуры там — давно не двигавшийся список, и
-- переносить его в новую систему как есть значит начинать с мусора.
--
-- Снимок только справочный: пока продажи идут через Posiflora, источник
-- правды по остаткам — она. В день перехода снимок станет начальным
-- остатком (документ «opening»).
-- ================================================================

begin;

alter table inv_posiflora_snapshot
  add column if not exists unit_cost         numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  add column if not exists last_movement_at  timestamptz,
  add column if not exists movements         integer not null default 0,
  add column if not exists training_qty      numeric(12,3) not null default 0;

comment on column inv_posiflora_snapshot.qty is
  'Остаток в точке «Флория» — сумма qty всех движений.';
comment on column inv_posiflora_snapshot.unit_cost is
  'Себестоимость единицы остатка по суммам движений; null, если остатка нет или сумм нет.';
comment on column inv_posiflora_snapshot.last_movement_at is
  'Последнее движение по позиции. Давно не двигалась — кандидат на скрытие.';
comment on column inv_posiflora_snapshot.training_qty is
  'Остаток на тренировочном складе «СКЛАД». По словам владельца он не настоящий; хранится, чтобы было видно, сколько его.';

commit;
