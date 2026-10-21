"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { patchItem, quickAction, reverseDocument } from "@/lib/uchet/actions";
import type { GroupOption, ReasonOption, StockRow } from "@/lib/uchet/queries";
import { PAYMENT_LABEL, daysLabel, daysSince, formatMoney, formatQty, type PaymentMethod } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { ItemPhoto } from "@/components/uchet/sklad/ItemPhoto";

type Tab = "writeoff" | "receipt" | "count" | "edit";

const TABS: { key: Tab; label: string }[] = [
  { key: "writeoff", label: "Списать" },
  { key: "receipt", label: "Приход" },
  { key: "count", label: "Пересчитать" },
  { key: "edit", label: "Изменить" },
];

/** Способы оплаты закупки, которые реально встречаются, — кнопками, без выпадающего списка. */
const QUICK_PAYMENTS: PaymentMethod[] = ["cash", "card", "transfer", "unpaid"];

function parseNum(value: string): number | null {
  const v = value.replace(/\s/g, "").replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

type Props = {
  row: StockRow;
  groups: GroupOption[];
  reasons: ReasonOption[];
  withCosts: boolean;
  isTraining: boolean;
  onClose: () => void;
};

/**
 * Панель позиции справа. Главное правило экрана склада: посмотреть и
 * сделать мелкое действие — НЕ уходя со списка. Списать три завявших
 * эустомы — это количество и кнопка причины, а не форма документа.
 */
export function ItemDrawer({ row, groups, reasons, withCosts, isTraining, onClose }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("writeoff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Поля быстрых действий
  const [qty, setQty] = useState("");
  const [reasonId, setReasonId] = useState("");
  const [comment, setComment] = useState("");
  const [cost, setCost] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [counted, setCounted] = useState("");

  // Поля правки
  const [price, setPrice] = useState(row.salePrice != null ? String(row.salePrice) : "");
  const [minQty, setMinQty] = useState(row.minQty != null ? String(row.minQty) : "");
  const [fresh, setFresh] = useState(row.freshDays != null ? String(row.freshDays) : "");
  const [groupId, setGroupId] = useState(row.groupId ?? "");

  // Другая позиция — чистые поля.
  useEffect(() => {
    setQty("");
    setReasonId("");
    setComment("");
    setCost("");
    setCounted("");
    setError(null);
    setPrice(row.salePrice != null ? String(row.salePrice) : "");
    setMinQty(row.minQty != null ? String(row.minQty) : "");
    setFresh(row.freshDays != null ? String(row.freshDays) : "");
    setGroupId(row.groupId ?? "");
  }, [row.id, row.salePrice, row.minQty, row.freshDays, row.groupId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activeReasons = reasons.filter((r) => r.isActive);
  const moved = daysSince(row.lastMovementAt);
  const costShown = withCosts ? (row.avgCost && row.avgCost > 0 ? row.avgCost : row.posifloraUnitCost) : null;

  async function run(action: Parameters<typeof quickAction>[0], verb: string) {
    setBusy(true);
    setError(null);
    const result = await quickAction(action);
    setBusy(false);
    if (!result.success) return setError(result.error);

    const docId = result.data.id;
    toast({
      tone: "ok",
      text: `${result.data.docNo}: ${verb}`,
      action: {
        label: "Отменить",
        run: async () => {
          const undo = await reverseDocument(docId, "Отмена сразу после проведения");
          toast(undo.success ? { tone: "ok", text: "Отменено — документ сторнирован, остаток вернулся" } : { tone: "error", text: undo.error });
          router.refresh();
        },
      },
    });
    setQty("");
    setCounted("");
    setComment("");
    router.refresh();
  }

  function submitWriteoff() {
    const n = parseNum(qty);
    if (n === null || Number.isNaN(n) || n <= 0) return setError("Сколько списать — число больше нуля");
    if (!row.fractional && !Number.isInteger(n)) return setError(`«${row.title}» считается целыми`);
    if (!reasonId) return setError("Выберите причину");
    run({ kind: "writeoff", itemId: row.id, qty: n, reasonId, comment }, `списано ${formatQty(n)} ${row.unit}`);
  }

  function submitReceipt() {
    const n = parseNum(qty);
    const c = parseNum(cost);
    if (n === null || Number.isNaN(n) || n <= 0) return setError("Сколько пришло — число больше нуля");
    if (!row.fractional && !Number.isInteger(n)) return setError(`«${row.title}» считается целыми`);
    if (c === null || Number.isNaN(c) || c < 0) return setError("Укажите цену закупки за единицу");
    run({ kind: "receipt", itemId: row.id, qty: n, unitCost: c, paymentMethod: payment }, `пришло ${formatQty(n)} ${row.unit}`);
  }

  function submitCount() {
    const n = parseNum(counted);
    if (n === null || Number.isNaN(n) || n < 0) return setError("Сколько насчитали — число, можно ноль");
    run({ kind: "count", itemId: row.id, counted: n }, `насчитали ${formatQty(n)} ${row.unit}`);
  }

  async function submitEdit() {
    const p = parseNum(price);
    const m = parseNum(minQty);
    const f = parseNum(fresh);
    if ([p, m, f].some((x) => Number.isNaN(x))) return setError("В числовых полях — только цифры");
    setBusy(true);
    setError(null);
    const result = await patchItem(row.id, { salePrice: p, minQty: m, freshDays: f, groupId: groupId || null });
    setBusy(false);
    if (!result.success) return setError(result.error);
    toast({ tone: "ok", text: "Сохранено" });
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    const result = await patchItem(row.id, { isActive: !row.isActive });
    setBusy(false);
    if (!result.success) return setError(result.error);
    toast({ tone: "ok", text: row.isActive ? "Позиция скрыта" : "Позиция снова в списках" });
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={row.title}>
      <button type="button" aria-label="Закрыть" onClick={onClose} className="absolute inset-0 bg-zinc-900/20" />

      <aside className="relative flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl">
        <div className="flex items-start gap-4 border-b border-zinc-200 p-5">
          <ItemPhoto itemId={row.id} photoUrl={row.photoUrl} title={row.title} />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold leading-snug text-zinc-900">{row.title}</h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              {row.groupTitle ?? "без группы"}
              {!row.isActive && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">скрыта</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className={ui.btnGhost} aria-label="Закрыть панель">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Главные цифры */}
          <dl className="grid grid-cols-2 gap-px bg-zinc-200">
            <div className="bg-white p-4">
              <dt className={ui.label}>{isTraining ? "Остаток в Posiflora" : "Остаток"}</dt>
              <dd className={`mt-1 text-2xl font-semibold tabular-nums ${((isTraining ? row.posifloraQty : row.qty) ?? 0) < 0 ? "text-red-600" : "text-zinc-900"}`}>
                {formatQty(isTraining ? row.posifloraQty : row.qty)} <span className="text-sm font-normal text-zinc-500">{row.unit}</span>
              </dd>
              <dd className="mt-0.5 text-xs text-zinc-500">
                {isTraining ? `в тренировке: ${formatQty(row.qty)}` : `в Posiflora: ${formatQty(row.posifloraQty)}`}
              </dd>
            </div>
            <div className="bg-white p-4">
              <dt className={ui.label}>Цена за {row.unit}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{row.salePrice ? formatMoney(row.salePrice) : "—"}</dd>
              {withCosts && <dd className="mt-0.5 text-xs text-zinc-500">себестоимость {costShown ? formatMoney(costShown) : "—"}</dd>}
            </div>
            <div className="bg-white p-4">
              <dt className={ui.label}>Двигалась</dt>
              <dd className="mt-1 text-sm text-zinc-800">{daysLabel(moved)}</dd>
            </div>
            <div className="bg-white p-4">
              <dt className={ui.label}>Свежесть</dt>
              <dd className="mt-1 text-sm text-zinc-800">
                {row.oldestBatchDays !== null
                  ? `старой партии ${row.oldestBatchDays} дн.${row.freshDays ? ` из ${row.freshDays}` : ""}`
                  : row.freshDays
                    ? `живёт ${row.freshDays} дн.`
                    : "срок не задан"}
              </dd>
            </div>
          </dl>

          {/* Быстрые действия */}
          <div className="p-5">
            <div className="flex gap-1 rounded-xl bg-zinc-100 p-1" role="tablist" aria-label="Действие">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => {
                    setTab(t.key);
                    setError(null);
                  }}
                  className={`min-h-[40px] flex-1 rounded-lg text-sm font-semibold transition ${
                    tab === t.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-5">
              {tab === "writeoff" && (
                <div className="flex flex-col gap-4">
                  <label htmlFor="dw-qty" className="block">
                    <span className={ui.label}>Сколько</span>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input id="dw-qty" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} className={`${ui.field} text-lg tabular-nums`} />
                      <span className="text-sm text-zinc-500">{row.unit}</span>
                    </div>
                  </label>
                  <div>
                    <span className={ui.label}>Причина</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {activeReasons.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setReasonId(r.id)}
                          aria-pressed={reasonId === r.id}
                          className={`${ui.chip} ${reasonId === r.id ? ui.chipOn : ui.chipOff}`}
                        >
                          {r.title}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input id="dw-comment" aria-label="Комментарий" placeholder="Комментарий, если нужно" value={comment} onChange={(e) => setComment(e.target.value)} className={ui.fieldSm} />
                  <button type="button" disabled={busy} onClick={submitWriteoff} className={ui.btnPrimary}>
                    {busy ? "Проводим…" : qty ? `Списать ${qty} ${row.unit}` : "Списать"}
                  </button>
                </div>
              )}

              {tab === "receipt" && (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <label htmlFor="dr-qty">
                      <span className={ui.label}>Сколько пришло</span>
                      <input id="dr-qty" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} className={`${ui.field} mt-1.5 text-lg tabular-nums`} />
                    </label>
                    <label htmlFor="dr-cost">
                      <span className={ui.label}>Цена за {row.unit}, ₽</span>
                      <input id="dr-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className={`${ui.field} mt-1.5 text-lg tabular-nums`} />
                    </label>
                  </div>
                  <div>
                    <span className={ui.label}>Чем оплачено</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {QUICK_PAYMENTS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPayment(m)}
                          aria-pressed={payment === m}
                          className={`${ui.chip} ${payment === m ? ui.chipOn : ui.chipOff}`}
                        >
                          {PAYMENT_LABEL[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(() => {
                    const n = parseNum(qty);
                    const c = parseNum(cost);
                    return n && c && Number.isFinite(n) && Number.isFinite(c) ? (
                      <p className="text-sm text-zinc-600">
                        На сумму <span className="font-semibold tabular-nums text-zinc-900">{formatMoney(Math.round(n * c * 100) / 100)}</span>
                      </p>
                    ) : null;
                  })()}
                  <button type="button" disabled={busy} onClick={submitReceipt} className={ui.btnPrimary}>
                    {busy ? "Проводим…" : "Провести приход"}
                  </button>
                  <p className="text-xs text-zinc-500">
                    Привезли много позиций сразу — удобнее{" "}
                    <Link href="/uchet/sklad/docs/new?type=receipt" className="underline underline-offset-2">
                      общий приход
                    </Link>
                    .
                  </p>
                </div>
              )}

              {tab === "count" && (
                <div className="flex flex-col gap-4">
                  <label htmlFor="dc-qty">
                    <span className={ui.label}>Сколько насчитали</span>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input id="dc-qty" inputMode="decimal" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} className={`${ui.field} text-lg tabular-nums`} />
                      <span className="text-sm text-zinc-500">{row.unit}</span>
                    </div>
                  </label>
                  {(() => {
                    const n = parseNum(counted);
                    if (n === null || Number.isNaN(n)) return <p className="text-sm text-zinc-500">По учёту сейчас {formatQty(row.qty)} {row.unit}.</p>;
                    const diff = n - row.qty;
                    return (
                      <p className="text-sm text-zinc-600">
                        По учёту {formatQty(row.qty)} → будет {formatQty(n)}:{" "}
                        <span className={`font-semibold tabular-nums ${diff < 0 ? "text-red-600" : diff > 0 ? "text-emerald-700" : "text-zinc-900"}`}>
                          {diff > 0 ? "+" : ""}
                          {formatQty(diff)}
                        </span>
                      </p>
                    );
                  })()}
                  <button type="button" disabled={busy} onClick={submitCount} className={ui.btnPrimary}>
                    {busy ? "Проводим…" : "Записать пересчёт"}
                  </button>
                </div>
              )}

              {tab === "edit" && (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <label htmlFor="de-price">
                      <span className={ui.label}>Цена за {row.unit}, ₽</span>
                      <input id="de-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={`${ui.field} mt-1.5 tabular-nums`} />
                    </label>
                    <label htmlFor="de-min">
                      <span className={ui.label}>Минимум</span>
                      <input id="de-min" inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)} className={`${ui.field} mt-1.5 tabular-nums`} />
                    </label>
                    <label htmlFor="de-fresh">
                      <span className={ui.label}>Живёт, дней</span>
                      <input id="de-fresh" inputMode="numeric" value={fresh} onChange={(e) => setFresh(e.target.value)} className={`${ui.field} mt-1.5 tabular-nums`} />
                    </label>
                    <label htmlFor="de-group">
                      <span className={ui.label}>Группа</span>
                      <select id="de-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={`${ui.field} mt-1.5`}>
                        <option value="">Без группы</option>
                        {groups
                          .filter((g) => g.isActive || g.id === groupId)
                          .map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <button type="button" disabled={busy} onClick={submitEdit} className={ui.btnPrimary}>
                    {busy ? "Сохраняем…" : "Сохранить"}
                  </button>
                  <button type="button" disabled={busy} onClick={toggleActive} className={ui.btnSecondary}>
                    {row.isActive ? "Скрыть позицию" : "Вернуть в списки"}
                  </button>
                </div>
              )}

              {error && (
                <p className="mt-3 text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-200 p-4">
          <Link href={`/uchet/sklad/items/${row.id}`} className={`${ui.btnSecondary} w-full`}>
            Карточка и вся история
          </Link>
        </div>
      </aside>
    </div>
  );
}
