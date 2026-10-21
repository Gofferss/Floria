"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DayMark, EmployeePay, Payroll } from "@/lib/uchet/payroll";
import { addAdjustment, addPayout, deleteAdjustment, deletePayout, linkPosifloraWorker, setPayScheme, setWorkDay } from "@/lib/uchet/payroll-actions";
import { PAY_KINDS, PAYOUT_METHODS, SALES_BASES, describeScheme, type PayKind, type PayPart, type SalesBase } from "@/lib/uchet/pay-parts";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { CloseButton, Panel } from "@/components/uchet/Overlay";

const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
const toNumber = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

type Run = (fn: () => Promise<{ success: true } | { success: false; error: string }>, ok?: string) => Promise<boolean>;

/** Всё про зарплату одного человека за месяц: расчёт, схема, табель, премии, выдачи. */
export function PayPanel({ e, payroll, onClose }: { e: EmployeePay; payroll: Payroll; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run: Run = async (fn, ok) => {
    setBusy(true);
    // Сервер может и бросить (например, вход истёк) — панель не должна
    // остаться «занятой» навсегда.
    const result = await fn().catch((e: unknown) => ({ success: false as const, error: e instanceof Error ? e.message : "Не получилось — обновите страницу" }));
    setBusy(false);
    if (!result.success) {
      toast({ tone: "error", text: result.error });
      return false;
    }
    if (ok) toast({ tone: "ok", text: ok });
    router.refresh();
    return true;
  };

  return (
    <Panel label={`Зарплата: ${e.fullName}`} onClose={onClose}>
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-100 bg-white px-5 py-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-zinc-900">{e.fullName}</h2>
          <p className="text-sm text-zinc-500">Осталось выдать: <b className="tabular-nums text-zinc-900">{formatMoney(e.balance)}</b></p>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      <div className="space-y-6 px-5 py-5">
        <Breakdown e={e} />
        <Scheme e={e} month={payroll.month} busy={busy} run={run} />
        <Timesheet e={e} payroll={payroll} busy={busy} run={run} />
        <Adjustments e={e} month={payroll.month} busy={busy} run={run} />
        <Payouts e={e} today={payroll.today} busy={busy} run={run} />
        <PosifloraLink e={e} payroll={payroll} busy={busy} run={run} />
      </div>
    </Panel>
  );
}

function Breakdown({ e }: { e: EmployeePay }) {
  return (
    <section>
      <h3 className={ui.label}>Расчёт за месяц</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {e.lines.length === 0 && <li className="text-zinc-500">Схема не задана — начислять не по чему.</li>}
        {e.lines.map((l, i) => (
          <li key={i}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-zinc-800">
                {l.label} <span className="text-zinc-500">{l.detail}</span>
              </span>
              <span className="shrink-0 tabular-nums font-medium text-zinc-900">{formatMoney(l.amount)}</span>
            </div>
            {l.note && <p className="text-xs text-amber-800">{l.note}</p>}
          </li>
        ))}
        {e.adjustmentsTotal !== 0 && <Row label="Премии и удержания" value={e.adjustmentsTotal} />}
        <li className="border-t border-zinc-100 pt-2">
          <Row label="Начислено за месяц" value={e.accrued + e.adjustmentsTotal} bold />
        </li>
        {e.carried !== 0 && <Row label={e.carried > 0 ? "Долг с прошлых месяцев" : "Переплата с прошлых месяцев"} value={e.carried} />}
        <Row label="Выдано в этом месяце" value={-e.paidTotal} />
        <li className="border-t border-zinc-100 pt-2">
          <Row label="Осталось выдать" value={e.balance} bold />
        </li>
      </ul>
      {e.ownSales > 0 && <p className="mt-2 text-xs text-zinc-500">Свои продажи за месяц: {formatMoney(Math.round(e.ownSales))}</p>}
    </section>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${bold ? "font-semibold text-zinc-900" : "text-zinc-700"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatMoney(Math.round(value) || 0)}</span>
    </div>
  );
}

// ---------------------------------------------------------------
// Схема
// ---------------------------------------------------------------

type Draft = { kind: PayKind; value: string; base: SalesBase };

const toDraft = (p: PayPart): Draft => ({ kind: p.kind, value: String(p.kind === "sales_percent" ? p.percent ?? "" : p.amount ?? ""), base: p.base ?? "own" });

function Scheme({ e, month, busy, run }: { e: EmployeePay; month: string; busy: boolean; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [parts, setParts] = useState<Draft[]>(e.current.map(toDraft));
  const [from, setFrom] = useState(`${month}-01`);
  const versions = new Set(e.rules.map((r) => r.validFrom)).size;

  function start() {
    setParts(e.current.length ? e.current.map(toDraft) : [{ kind: "monthly", value: "", base: "own" }]);
    setFrom(`${month}-01`);
    setEditing(true);
  }

  async function save() {
    const clean: PayPart[] = parts.map((p) =>
      p.kind === "sales_percent"
        ? { kind: p.kind, amount: null, percent: toNumber(p.value), base: p.base }
        : { kind: p.kind, amount: toNumber(p.value), percent: null, base: null }
    );
    if (await run(() => setPayScheme(e.id, from, clean), "Схема сохранена")) setEditing(false);
  }

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={ui.label}>Схема оплаты</h3>
        {!editing && (
          <button type="button" onClick={start} className="text-sm font-semibold text-lavender-700 underline underline-offset-2">
            {e.current.length ? "изменить" : "задать"}
          </button>
        )}
      </div>
      {!editing ? (
        <>
          <p className={`mt-1 text-[15px] ${e.current.length ? "text-zinc-900" : "text-amber-800"}`}>{describeScheme(e.current)}</p>
          {e.currentFrom && <p className="text-xs text-zinc-500">действует с {fmtDay(e.currentFrom)}</p>}
          {versions > 1 && <p className="mt-1 text-xs text-zinc-500">В этом месяце схема менялась — расчёт выше по дням каждой.</p>}
        </>
      ) : (
        <div className="mt-2 space-y-3 rounded-xl bg-zinc-50 p-3">
          {parts.map((p, i) => (
            <div key={i} className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-zinc-200">
              <div className="flex gap-2">
                <select value={p.kind} onChange={(ev) => setParts(parts.map((x, j) => (j === i ? { ...x, kind: ev.target.value as PayKind } : x)))} className={ui.fieldSm}>
                  {PAY_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setParts(parts.filter((_, j) => j !== i))} className={`${ui.btnGhost} min-h-[38px]`} aria-label="Убрать часть">
                  ✕
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  inputMode="decimal"
                  value={p.value}
                  onChange={(ev) => setParts(parts.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))}
                  placeholder={p.kind === "sales_percent" ? "5" : "50 000"}
                  className={`${ui.fieldSm} w-32`}
                />
                <span className="text-sm text-zinc-600">{p.kind === "sales_percent" ? "%" : "₽"}</span>
                {p.kind === "sales_percent" && (
                  <select value={p.base} onChange={(ev) => setParts(parts.map((x, j) => (j === i ? { ...x, base: ev.target.value as SalesBase } : x)))} className={`${ui.fieldSm} w-auto flex-1`}>
                    {SALES_BASES.map((b) => (
                      <option key={b.base} value={b.base}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="text-xs text-zinc-500">{PAY_KINDS.find((k) => k.kind === p.kind)?.hint}</p>
            </div>
          ))}
          <button type="button" onClick={() => setParts([...parts, { kind: "per_shift", value: "", base: "own" }])} className={`${ui.btnSecondary} min-h-[38px] w-full`}>
            + Часть схемы
          </button>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-zinc-600">Действует с</span>
            <input type="date" value={from} onChange={(ev) => setFrom(ev.target.value)} className={ui.fieldSm} />
            <span className="mt-1 block text-xs text-zinc-500">До этого дня всё считается по прежней схеме.</span>
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !from} onClick={save} className={`${ui.btnPrimary} flex-1`}>
              {busy ? "…" : "Сохранить схему"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={ui.btnGhost}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------
// Табель
// ---------------------------------------------------------------

const WEEK = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function Timesheet({ e, payroll, busy, run }: { e: EmployeePay; payroll: Payroll; busy: boolean; run: Run }) {
  // Отметка видна сразу, не дожидаясь пересчёта месяца.
  const [days, setDays] = useState<DayMark[]>(e.days);
  useEffect(() => setDays(e.days), [e.days]);

  const first = new Date(`${payroll.month}-01T12:00:00Z`).getUTCDay();
  const offset = (first + 6) % 7;
  const worked = days.filter((d) => d.worked && d.day <= payroll.to).length;

  async function toggle(d: DayMark) {
    if (busy || d.day > payroll.today) return;
    const next = !d.worked;
    setDays(days.map((x) => (x.day === d.day ? { ...x, manual: next, worked: next } : x)));
    const ok = await run(() => setWorkDay(e.id, d.day, next));
    if (!ok) setDays(e.days);
  }

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={ui.label}>Табель</h3>
        <span className="text-sm text-zinc-700">
          отработано <b className="tabular-nums">{worked}</b>
        </span>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {WEEK.map((w) => (
          <span key={w} className="text-[11px] text-zinc-400">
            {w}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`x${i}`} />
        ))}
        {days.map((d) => {
          const future = d.day > payroll.today;
          return (
            <button
              key={d.day}
              type="button"
              disabled={future}
              onClick={() => toggle(d)}
              aria-pressed={d.worked}
              aria-label={`${fmtDay(d.day)}: ${d.worked ? "работал" : "не работал"}${d.manual !== null ? ", отмечено вручную" : d.auto ? (d.auto === "posiflora" ? ", по смене Posiflora" : ", по входу с PIN") : ""}`}
              className={`relative flex h-10 items-center justify-center rounded-lg text-sm tabular-nums transition ${
                future ? "text-zinc-300" : d.worked ? "bg-lavender-600 font-semibold text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              {Number(d.day.slice(8, 10))}
              {d.manual !== null && <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${d.worked ? "bg-white" : "bg-zinc-500"}`} />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        Касание — работал / не работал. Сами ставятся дни по сменам Posiflora (до запуска) и по входу с PIN (после). Точка в углу — отмечено вручную.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------
// Премии и удержания
// ---------------------------------------------------------------

function Adjustments({ e, month, busy, run }: { e: EmployeePay; month: string; busy: boolean; run: Run }) {
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");

  async function add() {
    const value = toNumber(amount);
    if (await run(() => addAdjustment(e.id, month, sign * value, comment), sign > 0 ? "Премия добавлена" : "Удержание добавлено")) {
      setAmount("");
      setComment("");
    }
  }

  return (
    <section>
      <h3 className={ui.label}>Премии и удержания</h3>
      {e.adjustments.length > 0 && (
        <ul className="mt-2 divide-y divide-zinc-100 text-sm">
          {e.adjustments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-zinc-800">{a.comment}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`tabular-nums font-medium ${a.amount > 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {a.amount > 0 ? "+" : "−"}
                  {formatMoney(Math.abs(a.amount))}
                </span>
                <button type="button" disabled={busy} onClick={() => run(() => deleteAdjustment(a.id))} className="text-zinc-400 hover:text-red-600" aria-label="Удалить">
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <div className="flex overflow-hidden rounded-lg ring-1 ring-zinc-300">
          <button type="button" onClick={() => setSign(1)} className={`px-3 text-sm font-semibold ${sign > 0 ? "bg-zinc-900 text-white" : "bg-white text-zinc-700"}`}>
            Премия
          </button>
          <button type="button" onClick={() => setSign(-1)} className={`px-3 text-sm font-semibold ${sign < 0 ? "bg-zinc-900 text-white" : "bg-white text-zinc-700"}`}>
            Удержание
          </button>
        </div>
        <input inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="сумма" className={`${ui.fieldSm} w-28`} />
        <input value={comment} onChange={(ev) => setComment(ev.target.value)} placeholder="за что" className={`${ui.fieldSm} min-w-[140px] flex-1`} />
        <button type="button" disabled={busy || !amount || !comment.trim()} onClick={add} className={`${ui.btnSecondary} min-h-[38px] px-4`}>
          Добавить
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------
// Выдачи
// ---------------------------------------------------------------

const METHOD_LABEL: Record<string, string> = Object.fromEntries(PAYOUT_METHODS.map((m) => [m.method, m.label]));

function Payouts({ e, today, busy, run }: { e: EmployeePay; today: string; busy: boolean; run: Run }) {
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("card");
  const [comment, setComment] = useState("");

  async function add() {
    if (await run(() => addPayout(e.id, paidOn, toNumber(amount), method, comment), "Выдача записана")) {
      setAmount("");
      setComment("");
    }
  }

  return (
    <section>
      <h3 className={ui.label}>Выдано</h3>
      {e.payouts.length > 0 ? (
        <ul className="mt-2 divide-y divide-zinc-100 text-sm">
          {e.payouts.map((p, i) => (
            <li key={p.id ?? `till${i}`} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-zinc-800">
                {fmtDay(p.paidOn)} · {p.source === "till" ? "из кассы" : METHOD_LABEL[p.method] ?? p.method}
                {p.comment && <span className="text-zinc-500"> · {p.comment}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums font-medium text-zinc-900">{formatMoney(p.amount)}</span>
                {p.id && (
                  <button type="button" disabled={busy} onClick={() => run(() => deletePayout(p.id!))} className="text-zinc-400 hover:text-red-600" aria-label="Удалить">
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-zinc-500">В этом месяце не выдавали.</p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input type="date" value={paidOn} max={today} onChange={(ev) => setPaidOn(ev.target.value)} className={ui.fieldSm} />
        <input inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="сумма" className={ui.fieldSm} />
        <select value={method} onChange={(ev) => setMethod(ev.target.value)} className={ui.fieldSm}>
          {PAYOUT_METHODS.map((m) => (
            <option key={m.method} value={m.method}>
              {m.label}
            </option>
          ))}
        </select>
        <input value={comment} onChange={(ev) => setComment(ev.target.value)} placeholder="комментарий" className={ui.fieldSm} />
      </div>
      <button type="button" disabled={busy || !amount} onClick={add} className={`${ui.btnSecondary} mt-2 min-h-[38px] w-full`}>
        Записать выдачу
      </button>
      <p className="mt-1 text-xs text-zinc-500">Выдачи из кассы Учёта (Смена → Изъять → Зарплата) появляются здесь сами. Из кассы Posiflora — впишите вручную.</p>
    </section>
  );
}

// ---------------------------------------------------------------
// Связь с Posiflora
// ---------------------------------------------------------------

function PosifloraLink({ e, payroll, busy, run }: { e: EmployeePay; payroll: Payroll; busy: boolean; run: Run }) {
  const free = payroll.posifloraWorkers.filter((w) => w.id === e.posifloraWorkerId || payroll.unlinked.some((u) => u.id === w.id));
  return (
    <section>
      <h3 className={ui.label}>В Posiflora</h3>
      <select
        value={e.posifloraWorkerId ?? ""}
        disabled={busy}
        onChange={(ev) => run(() => linkPosifloraWorker(e.id, ev.target.value || null), "Связь сохранена")}
        className={`${ui.fieldSm} mt-2`}
      >
        <option value="">— нет в Posiflora —</option>
        {free.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-zinc-500">До запуска учёта личные продажи и смены человека берутся отсюда.</p>
    </section>
  );
}
