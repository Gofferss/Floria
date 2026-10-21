"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveItem } from "@/lib/uchet/actions";
import type { GroupOption, ItemEditable, UnitOption } from "@/lib/uchet/queries";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";

type Props = {
  item?: ItemEditable;
  groups: GroupOption[];
  units: UnitOption[];
};

function toNumber(value: string): number | null {
  const v = value.replace(",", ".").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Карточка позиции склада. Количество здесь не редактируется вовсе —
 * остаток меняется только документами (приход, списание, инвентаризация),
 * иначе журнал перестал бы сходиться с цифрой.
 */
export function ItemForm({ item, groups, units }: Props) {
  const router = useRouter();

  const [title, setTitle] = useState(item?.title ?? "");
  const [groupId, setGroupId] = useState(item?.groupId ?? "");
  const [unitCode, setUnitCode] = useState(item?.unitCode ?? "pcs");
  const [fractional, setFractional] = useState(item?.fractional ?? false);
  const [isTracked, setIsTracked] = useState(item?.isTracked ?? true);
  const [salePrice, setSalePrice] = useState(item?.salePrice != null ? String(item.salePrice) : "");
  const [minQty, setMinQty] = useState(item?.minQty != null ? String(item.minQty) : "");
  const [freshDays, setFreshDays] = useState(item?.freshDays != null ? String(item.freshDays) : "");
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [isActive, setIsActive] = useState(item?.isActive ?? true);

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const price = toNumber(salePrice);
    const min = toNumber(minQty);
    const fresh = toNumber(freshDays);
    if (Number.isNaN(price) || Number.isNaN(min) || Number.isNaN(fresh)) {
      setError("В числовых полях — только цифры");
      return;
    }

    setBusy(true);
    const result = await saveItem({
      id: item?.id,
      title,
      groupId: groupId || null,
      unitCode,
      fractional,
      isTracked,
      salePrice: price,
      minQty: min,
      freshDays: fresh,
      barcode: barcode || null,
      notes: notes || null,
      isActive,
    });
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    if (!item) {
      router.push(`/uchet/sklad/items/${result.data.id}`);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField label="Название" htmlFor="item-title" required>
            <input id="item-title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass()} />
          </FormField>
        </div>

        <FormField label="Группа" htmlFor="item-group">
          <select id="item-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputClass()}>
            <option value="">Без группы</option>
            {groups
              .filter((g) => g.isActive || g.id === groupId)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
          </select>
        </FormField>

        <FormField label="Единица" htmlFor="item-unit">
          <select id="item-unit" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} className={inputClass()}>
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.title} ({u.shortTitle})
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Цена продажи поштучно, ₽" htmlFor="item-price" hint="Если продаёте эту позицию отдельно">
          <input id="item-price" inputMode="decimal" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} className={inputClass()} />
        </FormField>

        <FormField label="Минимальный остаток" htmlFor="item-min" hint="Ниже — позиция подсветится и попадёт в список закупки">
          <input id="item-min" inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)} className={inputClass()} />
        </FormField>

        <FormField label="Срок свежести, дней" htmlFor="item-fresh" hint="Сколько живёт. Старше — подсветится «пора в работу»">
          <input id="item-fresh" inputMode="numeric" value={freshDays} onChange={(e) => setFreshDays(e.target.value)} className={inputClass()} />
        </FormField>

        <FormField label="Штрихкод" htmlFor="item-barcode">
          <input id="item-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputClass()} />
        </FormField>

        <div className="sm:col-span-2">
          <FormField label="Заметки" htmlFor="item-notes">
            <textarea id="item-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass()} />
          </FormField>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <label htmlFor="item-fractional" className="flex items-center gap-3 font-body text-sm text-ink">
          <input id="item-fractional" type="checkbox" checked={fractional} onChange={(e) => setFractional(e.target.checked)} className="h-4 w-4 accent-lavender-600" />
          Можно дробное количество (метры ленты, половина упаковки)
        </label>
        <label htmlFor="item-tracked" className="flex items-center gap-3 font-body text-sm text-ink">
          <input id="item-tracked" type="checkbox" checked={isTracked} onChange={(e) => setIsTracked(e.target.checked)} className="h-4 w-4 accent-lavender-600" />
          Вести остаток (выключите для услуг: доставка, работа флориста)
        </label>
        <label htmlFor="item-active" className="flex items-center gap-3 font-body text-sm text-ink">
          <input id="item-active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-lavender-600" />
          Действующая позиция (снимите, чтобы скрыть из списков, не удаляя историю)
        </label>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-lavender-600 px-6 py-3 font-display text-sm font-semibold text-white shadow-sm transition hover:bg-lavender-700 disabled:opacity-50"
        >
          {busy ? "Сохраняем…" : item ? "Сохранить" : "Создать позицию"}
        </button>
        {saved && <span className="font-body text-sm text-green-700">Сохранено</span>}
        {error && <span className="font-body text-sm text-red-600">{error}</span>}
      </div>
    </form>
  );
}
