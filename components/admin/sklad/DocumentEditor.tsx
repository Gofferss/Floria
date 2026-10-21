"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteDraft, saveAndPost, saveDraft, type DraftInput } from "@/lib/uchet/actions";
import type { PickerItem, ReasonOption, SupplierOption } from "@/lib/uchet/queries";
import {
  DOC_TYPE_HINT,
  DOC_TYPE_LABEL,
  PAYMENT_LABEL,
  PAYMENT_METHODS,
  formatMoney,
  formatQty,
  type DocType,
  type PaymentMethod,
} from "@/lib/uchet/format";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";

export type EditorInitial = {
  id: string;
  docNo: string;
  date: string;
  supplierId: string | null;
  reasonId: string | null;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
  lines: { itemId: string; qty: number; unitCost: number | null }[];
};

type Props = {
  docType: DocType;
  initial?: EditorInitial;
  items: PickerItem[];
  suppliers: SupplierOption[];
  reasons: ReasonOption[];
  withCosts: boolean;
};

type Line = { key: string; itemId: string; qty: string; unitCost: string };

let keySeq = 0;
const nextKey = () => `l${++keySeq}`;

/** «12,5» → 12.5; пусто → null; мусор → NaN. */
function parseNum(value: string): number | null {
  const v = value.replace(/\s/g, "").replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" }).format(new Date());
}

function dateOnly(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" }).format(new Date(iso));
}

/**
 * Дата документа. Если выбран сегодняшний день — отдаём null, и база
 * поставит точное время проведения: так два прихода за день не
 * сольются по времени. Прошлый день — полдень по Симферополю, чтобы
 * никакой часовой пояс не перенёс документ на соседние сутки.
 */
function dateForServer(date: string): string | null {
  if (!date || date === todayLocal()) return null;
  return `${date}T12:00:00+03:00`;
}

export function DocumentEditor({ docType, initial, items, suppliers, reasons, withCosts }: Props) {
  const router = useRouter();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [docId, setDocId] = useState<string | undefined>(initial?.id);
  const [date, setDate] = useState(initial ? dateOnly(initial.date) : todayLocal());
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [reasonId, setReasonId] = useState(initial?.reasonId ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(initial?.paymentMethod ?? "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [lines, setLines] = useState<Line[]>(
    initial?.lines.map((l) => ({
      key: nextKey(),
      itemId: l.itemId,
      qty: String(l.qty),
      unitCost: l.unitCost != null ? String(l.unitCost) : "",
    })) ?? []
  );

  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<"save" | "post" | "delete" | null>(null);
  const [confirm, setConfirm] = useState<"post" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const qtyRefs = useRef(new Map<string, HTMLInputElement>());

  const showCost = docType === "receipt" || (docType === "opening" && withCosts);
  const costRequired = docType === "receipt";
  const inLines = useMemo(() => new Set(lines.map((l) => l.itemId)), [lines]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) => i.isActive && !inLines.has(i.id) && i.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, items, inLines]);

  function addLine(itemId: string) {
    if (inLines.has(itemId)) return;
    const key = nextKey();
    setLines((prev) => [...prev, { key, itemId, qty: "", unitCost: "" }]);
    setSearch("");
    // Фокус на количество новой строки — следующее, что человек вводит.
    requestAnimationFrame(() => qtyRefs.current.get(key)?.focus());
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  const total = useMemo(() => {
    if (!showCost) return null;
    let sum = 0;
    for (const l of lines) {
      const q = parseNum(l.qty);
      const c = parseNum(l.unitCost);
      if (q && c && Number.isFinite(q) && Number.isFinite(c)) sum += q * c;
    }
    return Math.round(sum * 100) / 100;
  }, [lines, showCost]);

  function buildInput(): DraftInput | string {
    const built: DraftInput["lines"] = [];
    for (const [i, l] of lines.entries()) {
      const item = byId.get(l.itemId);
      const qty = parseNum(l.qty);
      const cost = parseNum(l.unitCost);
      const n = i + 1;
      if (qty === null || Number.isNaN(qty)) return `Строка ${n}: укажите количество цифрами`;
      if (qty < 0) return `Строка ${n}: количество не может быть отрицательным`;
      if (item && !item.fractional && !Number.isInteger(qty)) return `Строка ${n}: «${item.title}» считается целыми`;
      if (Number.isNaN(cost)) return `Строка ${n}: цена — только цифры`;
      if (costRequired && cost === null) return `Строка ${n}: укажите цену закупки`;
      built.push({ itemId: l.itemId, qty, unitCost: showCost ? cost : null });
    }
    return {
      id: docId,
      docType,
      docDate: dateForServer(date),
      supplierId: supplierId || null,
      writeoffReasonId: reasonId || null,
      paymentMethod: paymentMethod || null,
      comment: comment.trim() || null,
      lines: built,
    };
  }

  /** Новый черновик получил номер — адрес страницы меняем, не теряя ввода. */
  function rememberId(id: string) {
    if (!docId) {
      setDocId(id);
      window.history.replaceState(null, "", `/admin/sklad/docs/${id}`);
    }
  }

  async function handleSave() {
    setError(null);
    setNotice(null);
    const input = buildInput();
    if (typeof input === "string") return setError(input);

    setBusy("save");
    const result = await saveDraft(input);
    setBusy(null);
    if (!result.success) return setError(result.error);
    rememberId(result.data.id);
    setNotice("Черновик сохранён. Остатки не изменились, пока документ не проведён.");
  }

  async function handlePost() {
    setError(null);
    setNotice(null);
    const input = buildInput();
    if (typeof input === "string") {
      setConfirm(null);
      return setError(input);
    }

    setBusy("post");
    const result = await saveAndPost(input);
    setBusy(null);
    setConfirm(null);

    if (!result.success) {
      if (result.id) rememberId(result.id);
      return setError(result.error);
    }
    router.push(`/admin/sklad/docs/${result.data.id}`);
    router.refresh();
  }

  async function handleDelete() {
    if (!docId) return;
    setBusy("delete");
    const result = await deleteDraft(docId);
    setBusy(null);
    setConfirm(null);
    if (!result.success) return setError(result.error);
    router.push("/admin/sklad/docs");
    router.refresh();
  }

  const working = busy !== null;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl border border-lavender-100 bg-white p-6 sm:p-8">
        <p className="max-w-2xl font-body text-sm text-ink/65">{DOC_TYPE_HINT[docType]}</p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Дата" htmlFor="doc-date">
            <input id="doc-date" type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} className={inputClass()} />
          </FormField>

          {docType === "receipt" && (
            <>
              <FormField label="Поставщик" htmlFor="doc-supplier" hint="Необязательно">
                <select id="doc-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass()}>
                  <option value="">Не указан</option>
                  {suppliers
                    .filter((s) => s.isActive || s.id === supplierId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                </select>
              </FormField>
              <FormField label="Чем оплачено" htmlFor="doc-payment" hint="Необязательно">
                <select
                  id="doc-payment"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | "")}
                  className={inputClass()}
                >
                  <option value="">Не указано</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_LABEL[m]}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          )}

          {docType === "writeoff" && (
            <FormField label="Причина" htmlFor="doc-reason" required>
              <select id="doc-reason" value={reasonId} onChange={(e) => setReasonId(e.target.value)} className={inputClass(!reasonId && !!error)}>
                <option value="">Выберите…</option>
                {reasons
                  .filter((r) => r.isActive || r.id === reasonId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
              </select>
            </FormField>
          )}

          <div className={docType === "receipt" ? "sm:col-span-2 lg:col-span-3" : "sm:col-span-1 lg:col-span-2"}>
            <FormField label="Комментарий" htmlFor="doc-comment">
              <input id="doc-comment" value={comment} onChange={(e) => setComment(e.target.value)} className={inputClass()} />
            </FormField>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-6 sm:p-8">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink/50">Позиции</h2>

        <div className="relative mt-4">
          <label htmlFor="doc-search" className="sr-only">
            Добавить позицию
          </label>
          <input
            id="doc-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (matches[0]) addLine(matches[0].id);
              }
              if (e.key === "Escape") setSearch("");
            }}
            placeholder="Начните вводить название — Enter добавит первую"
            autoComplete="off"
            className={inputClass()}
          />
          {matches.length > 0 && (
            <ul className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-2xl border border-lavender-200 bg-white py-1 shadow-lg">
              {matches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => addLine(m.id)}
                    className="flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-lavender-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-body text-sm text-ink">{m.title}</span>
                      <span className="font-body text-xs text-ink/45">{m.groupTitle ?? "без группы"}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-ink/45">
                      у нас {formatQty(m.qty)} · Posiflora {formatQty(m.posifloraQty)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-lavender-200 px-5 py-8 text-center font-body text-sm text-ink/50">
            Пока пусто. Найдите позицию в поле выше.
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-lavender-100">
            {lines.map((l, i) => {
              const item = byId.get(l.itemId);
              const qty = parseNum(l.qty);
              const cost = parseNum(l.unitCost);
              const lineSum = qty && cost && Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : null;
              const diff = docType === "inventory" && qty !== null && Number.isFinite(qty) && item ? qty - item.qty : null;
              return (
                <li key={l.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[1fr_8rem_9rem_7rem_auto]">
                  <div className="min-w-0">
                    <p className="truncate font-body text-sm font-medium text-ink">
                      <span className="mr-2 font-mono text-xs text-ink/35">{i + 1}</span>
                      {item?.title ?? "Позиция не найдена"}
                    </p>
                    <p className="font-body text-xs text-ink/45">
                      {docType === "inventory" && item
                        ? `по учёту ${formatQty(item.qty)} · в Posiflora ${formatQty(item.posifloraQty)}`
                        : item?.groupTitle ?? ""}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    aria-label={`Убрать «${item?.title ?? ""}»`}
                    className="justify-self-end rounded-full px-2.5 py-1 font-body text-lg leading-none text-ink/40 transition hover:bg-red-50 hover:text-red-600 sm:order-last"
                  >
                    ×
                  </button>

                  <label className="flex items-center gap-2">
                    <span className="sr-only">{docType === "inventory" ? "Насчитали" : "Количество"}</span>
                    <input
                      ref={(el) => {
                        if (el) qtyRefs.current.set(l.key, el);
                        else qtyRefs.current.delete(l.key);
                      }}
                      id={`qty-${l.key}`}
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                      placeholder={docType === "inventory" ? "насчитали" : "кол-во"}
                      className="w-full rounded-xl border border-lavender-200 bg-lavender-50 px-3 py-2 text-right font-mono text-sm tabular-nums text-ink outline-none focus:border-gold-400 focus:bg-white"
                    />
                    <span className="font-body text-xs text-ink/45">{item?.unit ?? "шт"}</span>
                  </label>

                  {showCost ? (
                    <label className="flex items-center gap-2">
                      <span className="sr-only">Цена за единицу</span>
                      <input
                        id={`cost-${l.key}`}
                        inputMode="decimal"
                        value={l.unitCost}
                        onChange={(e) => updateLine(l.key, { unitCost: e.target.value })}
                        placeholder={costRequired ? "цена, ₽" : "цена, необяз."}
                        className="w-full rounded-xl border border-lavender-200 bg-lavender-50 px-3 py-2 text-right font-mono text-sm tabular-nums text-ink outline-none focus:border-gold-400 focus:bg-white"
                      />
                      <span className="font-body text-xs text-ink/45">₽</span>
                    </label>
                  ) : (
                    <span className="hidden sm:block" />
                  )}

                  <span className="text-right font-mono text-sm tabular-nums text-ink/70">
                    {showCost
                      ? lineSum !== null
                        ? formatMoney(Math.round(lineSum * 100) / 100)
                        : ""
                      : diff !== null
                        ? <span className={diff < 0 ? "text-red-700" : diff > 0 ? "text-green-700" : ""}>
                            {diff > 0 ? "+" : ""}
                            {formatQty(diff)}
                          </span>
                        : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {total !== null && lines.length > 0 && (
          <p className="mt-4 border-t border-lavender-100 pt-4 text-right font-display text-base font-semibold text-ink">
            Итого: <span className="font-mono tabular-nums">{formatMoney(total)}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {confirm === "post" ? (
          <div className="rounded-3xl border border-gold-300 bg-gold-300/20 p-5">
            <p className="font-body text-sm text-ink">
              Провести {DOC_TYPE_LABEL[docType].toLowerCase()}? После этого документ не меняется — исправить можно только сторно.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handlePost}
                disabled={working}
                className="rounded-full bg-gold-500 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-gold-600 disabled:opacity-50"
              >
                {busy === "post" ? "Проводим…" : "Да, провести"}
              </button>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={working}
                className="rounded-full border border-lavender-200 bg-white px-6 py-2.5 font-display text-sm font-semibold text-ink transition hover:border-gold-400"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : confirm === "delete" ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
            <p className="font-body text-sm text-red-900">Удалить черновик? Остатков он не касался, но восстановить его нельзя.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={working}
                className="rounded-full bg-red-600 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {busy === "delete" ? "Удаляем…" : "Да, удалить"}
              </button>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={working}
                className="rounded-full border border-lavender-200 bg-white px-6 py-2.5 font-display text-sm font-semibold text-ink"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirm("post");
              }}
              disabled={working || lines.length === 0}
              className="rounded-full bg-gold-500 px-7 py-3 font-display text-sm font-semibold text-white shadow-sm transition hover:bg-gold-600 disabled:opacity-50"
            >
              Провести
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={working || lines.length === 0}
              className="rounded-full border border-lavender-200 bg-white px-7 py-3 font-display text-sm font-semibold text-ink transition hover:border-gold-400 hover:text-gold-700 disabled:opacity-50"
            >
              {busy === "save" ? "Сохраняем…" : "Сохранить черновик"}
            </button>
            {docId && (
              <button
                type="button"
                onClick={() => setConfirm("delete")}
                disabled={working}
                className="font-body text-sm text-ink/50 underline decoration-lavender-300 underline-offset-4 transition hover:text-red-600"
              >
                Удалить черновик
              </button>
            )}
          </div>
        )}

        {error && <p className="font-body text-sm text-red-600" role="alert">{error}</p>}
        {notice && <p className="font-body text-sm text-green-700">{notice}</p>}
      </div>
    </div>
  );
}
