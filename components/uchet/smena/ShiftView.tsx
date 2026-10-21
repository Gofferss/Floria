"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cashMove, closeShift, openShift, type CloseShiftResult } from "@/lib/uchet/pos-actions";
import type { CashLine, CashReasonOption, OpenShift } from "@/lib/uchet/pos-queries";
import { formatDateTime, formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { CloseButton, Dialog, Sheet } from "@/components/uchet/Overlay";
import { AmountDisplay, NumPad } from "@/components/uchet/NumPad";
import { useOutbox } from "@/components/uchet/kassa/outbox";

type Props = {
  shift: OpenShift | null;
  lastClosed: { closedAt: string; counted: number; expected: number } | null;
  cash: CashLine[];
  totals: { count: number; total: number; byMethod: { title: string; amount: number }[] } | null;
  reasons: CashReasonOption[];
  employees: { id: string; shortName: string }[];
};

function checksWord(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  if (last === 1 && tens !== 11) return "чек";
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return "чека";
  return "чеков";
}

const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Simferopol" });

/**
 * Смена: сколько наличных должно быть в кассе — главная цифра, всегда
 * наверху. Внести, изъять, закрыть — по кнопке, с причиной кнопкой, а не
 * текстом: «Эустома» в причине изъятия не превратить в отчёт.
 */
export function ShiftView({ shift, lastClosed, cash, totals, reasons, employees }: Props) {
  const [dialog, setDialog] = useState<null | "open" | "in" | "out" | "close">(null);
  const [closed, setClosed] = useState<CloseShiftResult | null>(null);
  const outbox = useOutbox();

  if (!shift) {
    return (
      <div className={ui.page}>
        <div className="mx-auto max-w-xl">
          <section className={`${ui.cardPad} text-center`}>
            <p className={ui.label}>Смена закрыта</p>
            <h1 className="mt-2 font-display text-2xl font-bold text-zinc-900">Откройте смену, чтобы продавать</h1>
            <p className={`${ui.muted} mx-auto mt-2 max-w-md`}>
              Пересчитайте наличные в кассе и введите сумму. С неё начнётся расчёт «сколько должно быть в кассе».
            </p>
            {lastClosed && (
              <p className="mt-4 text-sm text-zinc-600">
                Прошлое закрытие {formatDateTime(lastClosed.closedAt)}: насчитали{" "}
                <span className="font-semibold tabular-nums">{formatMoney(lastClosed.counted)}</span>
              </p>
            )}
            <button type="button" onClick={() => setDialog("open")} className={`${ui.btnPrimary} mt-6 min-h-[52px] px-8 text-base`}>
              Открыть смену
            </button>
          </section>
          {closed && <ClosedSummary result={closed} />}
        </div>
        {dialog === "open" && <OpenDialog lastCounted={lastClosed?.counted ?? null} onClose={() => setDialog(null)} />}
      </div>
    );
  }

  return (
    <div className={ui.page}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className={ui.cardPad}>
          <p className={ui.label}>
            Смена с {timeFmt.format(new Date(shift.openedAt))}
            {shift.openedBy ? ` · ${shift.openedBy}` : ""}
          </p>
          <p className="mt-2 font-display text-4xl font-bold tabular-nums text-zinc-900">{formatMoney(Math.round(shift.expectedCash))}</p>
          <p className={ui.muted}>должно быть наличными в кассе</p>

          {shift.previousCounted !== null && shift.previousCounted !== shift.openingCash && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              При открытии было {formatMoney(shift.openingCash)}, а прошлую смену закрыли с {formatMoney(shift.previousCounted)}.
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setDialog("in")} className={`${ui.btnSecondary} min-h-[52px]`}>
              Внести
            </button>
            <button type="button" onClick={() => setDialog("out")} className={`${ui.btnSecondary} min-h-[52px]`}>
              Изъять
            </button>
          </div>
          <button type="button" disabled={outbox.length > 0} onClick={() => setDialog("close")} className={`${ui.btnPrimary} mt-2 min-h-[52px] w-full text-base`}>
            Закрыть смену
          </button>
          {outbox.length > 0 && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              На айпаде продаж без связи: {outbox.length}. Сначала они должны уйти на сервер (значок вверху) — иначе пересчёт кассы не сойдётся.
            </p>
          )}

          {totals && (
            <dl className="mt-6 space-y-2 border-t border-zinc-100 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-500">Продажи</dt>
                <dd className="font-semibold tabular-nums">
                  {formatMoney(totals.total)} · {totals.count} {checksWord(totals.count)}
                </dd>
              </div>
              {totals.byMethod.map((m) => (
                <div key={m.title} className="flex justify-between">
                  <dt className="text-zinc-500">{m.title}</dt>
                  <dd className="tabular-nums">{formatMoney(m.amount)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className={ui.card}>
          <h2 className={`${ui.h2} border-b border-zinc-100 px-5 py-4`}>Движения наличных</h2>
          <ul className="divide-y divide-zinc-100">
            {cash.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900">{c.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {timeFmt.format(new Date(c.at))}
                    {c.who ? ` · ${c.who}` : ""}
                    {c.note ? ` · ${c.note}` : ""}
                    {c.receiptDocId && (
                      <>
                        {" · "}
                        <Link href={`/uchet/sklad/docs/${c.receiptDocId}`} className="font-medium text-lavender-700 underline underline-offset-2">
                          приход
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <span className={`shrink-0 text-sm font-semibold tabular-nums ${c.amount < 0 ? "text-red-600" : "text-emerald-700"}`}>
                  {c.kind === "open" ? "" : c.amount > 0 ? "+" : "−"}
                  {formatMoney(Math.abs(c.amount))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {(dialog === "in" || dialog === "out") && (
        <CashDialog
          direction={dialog}
          shiftId={shift.id}
          available={shift.expectedCash}
          reasons={reasons.filter((r) => r.direction === dialog)}
          employees={employees}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "close" && (
        <CloseDialog
          shiftId={shift.id}
          expected={shift.expectedCash}
          onClose={() => setDialog(null)}
          onClosed={(r) => {
            setDialog(null);
            setClosed(r);
          }}
        />
      )}
    </div>
  );
}

function OpenDialog({ lastCounted, onClose }: { lastCounted: number | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(lastCounted !== null ? String(Math.round(lastCounted)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [id] = useState(() => crypto.randomUUID());

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await openShift({ id, cash: Number(value || "0") });
    setBusy(false);
    if (!result.success) return setError(result.error);
    toast({ tone: "ok", text: "Смена открыта" });
    onClose();
    router.refresh();
  }

  const n = Number(value || "0");
  return (
    <Dialog label="Открыть смену" onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Открыть смену</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Сколько наличных сейчас в кассе?</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="mt-4">
        <AmountDisplay value={value} />
      </div>
      {lastCounted !== null && n !== Math.round(lastCounted) && (
        <p className="mt-2 text-sm text-amber-800">Прошлую смену закрыли с {formatMoney(lastCounted)} — разница {formatMoney(n - lastCounted)}.</p>
      )}
      <div className="mt-3">
        <NumPad value={value} onChange={setValue} />
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button type="button" disabled={busy} onClick={submit} className={`${ui.btnPrimary} mt-4 min-h-[52px] w-full text-base`}>
        {busy ? "Открываем…" : "Открыть смену"}
      </button>
    </Dialog>
  );
}

function CashDialog({
  direction,
  shiftId,
  available,
  reasons,
  employees,
  onClose,
}: {
  direction: "in" | "out";
  shiftId: string;
  available: number;
  reasons: CashReasonOption[];
  employees: { id: string; shortName: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [paidTo, setPaidTo] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [id] = useState(() => crypto.randomUUID());

  const reason = reasons.find((r) => r.id === reasonId);
  const amount = Number(value || "0");

  async function submit() {
    if (!reason) return setError("Выберите причину");
    if (amount <= 0) return setError("Введите сумму");
    if (reason.kind === "salary" && !paidTo) return setError("Кому зарплата?");
    setBusy(true);
    setError(null);
    const result = await cashMove({ id, shiftId, reasonId, amount, paidEmployeeId: paidTo, comment });
    setBusy(false);
    if (!result.success) return setError(result.error);
    onClose();
    if (result.data.receiptDocId) {
      toast({ tone: "ok", text: `Изъято ${formatMoney(amount)}. Впишите, какие цветы пришли — приход уже открыт` });
      router.push(`/uchet/sklad/docs/${result.data.receiptDocId}`);
      return;
    }
    toast({ tone: "ok", text: direction === "in" ? `Внесено ${formatMoney(amount)}` : `Изъято ${formatMoney(amount)}` });
    router.refresh();
  }

  return (
    <Sheet label={direction === "in" ? "Внести наличные" : "Изъять наличные"} onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">{direction === "in" ? "Внести в кассу" : "Изъять из кассы"}</h2>
          {direction === "out" && <p className="mt-0.5 text-sm text-zinc-500">В кассе по учёту {formatMoney(Math.round(available))}</p>}
        </div>
        <CloseButton onClose={onClose} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Причина">
        {reasons.map((r) => (
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
      {reason?.kind === "purchase" && (
        <p className="mt-2 text-sm text-zinc-600">Следом откроется приход с оплатой «из кассы» — впишете, какие цветы купили.</p>
      )}
      {reason?.kind === "salary" && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Кому">
          {employees.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setPaidTo(e.id)}
              aria-pressed={paidTo === e.id}
              className={`${ui.chip} ${paidTo === e.id ? "bg-lavender-600 text-white" : ui.chipOff}`}
            >
              {e.shortName}
            </button>
          ))}
          {employees.length === 0 && <p className="text-sm text-amber-800">Сначала заведите людей в «Сотрудниках».</p>}
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <AmountDisplay value={value} />
          <input
            id="cash-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Комментарий, если нужен"
            aria-label="Комментарий"
            className={`${ui.field} mt-3`}
          />
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button type="button" disabled={busy} onClick={submit} className={`${ui.btnPrimary} mt-3 min-h-[52px] w-full text-base`}>
            {busy ? "Записываем…" : direction === "in" ? "Внести" : "Изъять"}
          </button>
        </div>
        <NumPad value={value} onChange={setValue} />
      </div>
    </Sheet>
  );
}

function CloseDialog({
  shiftId,
  expected,
  onClose,
  onClosed,
}: {
  shiftId: string;
  expected: number;
  onClose: () => void;
  onClosed: (r: CloseShiftResult) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counted = Number(value || "0");
  const diff = counted - expected;

  async function submit() {
    if (value === "") return setError("Пересчитайте наличные и введите сумму — можно ноль");
    setBusy(true);
    setError(null);
    const result = await closeShift({ shiftId, counted, comment });
    setBusy(false);
    if (!result.success) return setError(result.error);
    onClosed(result.data);
    router.refresh();
  }

  return (
    <Sheet label="Закрыть смену" onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Закрыть смену</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Пересчитайте наличные. Должно быть <span className="font-semibold tabular-nums text-zinc-800">{formatMoney(Math.round(expected))}</span>
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <AmountDisplay value={value} />
          {value !== "" && (
            <p className={`mt-2 text-sm font-semibold ${diff === 0 ? "text-emerald-700" : "text-amber-800"}`}>
              {diff === 0 ? "Сходится" : diff > 0 ? `Излишек ${formatMoney(diff)}` : `Не хватает ${formatMoney(-diff)}`}
            </p>
          )}
          <input
            id="close-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={diff !== 0 && value !== "" ? "Почему не сходится, если знаете" : "Комментарий, если нужен"}
            aria-label="Комментарий"
            className={`${ui.field} mt-3`}
          />
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button type="button" disabled={busy} onClick={submit} className={`${ui.btnPrimary} mt-3 min-h-[52px] w-full text-base`}>
            {busy ? "Закрываем…" : "Закрыть смену"}
          </button>
        </div>
        <NumPad value={value} onChange={setValue} />
      </div>
    </Sheet>
  );
}

function ClosedSummary({ result }: { result: CloseShiftResult }) {
  return (
    <section className={`${ui.cardPad} mt-4`} role="status">
      <h2 className={ui.h2}>Смена закрыта</h2>
      <p className="mt-2 text-sm text-zinc-700">
        Ожидалось {formatMoney(result.expected)}, насчитали {formatMoney(result.counted)}.{" "}
        {result.diff === 0 ? (
          <span className="font-semibold text-emerald-700">Касса сошлась.</span>
        ) : (
          <span className="font-semibold text-amber-800">
            {result.diff > 0 ? "Излишек" : "Недостача"} {formatMoney(Math.abs(result.diff))}.
          </span>
        )}
      </p>
    </section>
  );
}
