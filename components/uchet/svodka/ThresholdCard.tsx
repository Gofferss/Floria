"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Threshold } from "@/lib/uchet/summary";
import { saveIncomeExtra } from "@/lib/uchet/summary-actions";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { compactMoney, fmtDay } from "./fmt";

const MONTHS_GEN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_FROM = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const inMonth = (month: string) => MONTHS_GEN[Number(month.slice(5, 7)) - 1];
const monthName = (month: string) => MONTHS_NOM[Number(month.slice(5, 7)) - 1];
const fromMonth = (month: string) => MONTHS_FROM[Number(month.slice(5, 7)) - 1];

type Tone = "critical" | "warning" | "ok";

const TONE: Record<Tone, { badge: string; icon: string; label: string }> = {
  critical: { badge: "bg-red-50 text-red-800 ring-red-200", icon: "!", label: "Порог пройден" },
  warning: { badge: "bg-amber-50 text-amber-900 ring-amber-200", icon: "!", label: "По темпу порог будет пройден" },
  ok: { badge: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: "✓", label: "В пределах порога" },
};

/**
 * Доход с 1 января против порога 20 млн ₽. Самое дорогое, что может
 * пропустить владелец: превышение на УСН — это НДС с 1-го числа следующего
 * месяца, на патенте — потеря патента. Поэтому карточка всегда наверху и
 * говорит не «процент», а дату: когда и что наступит.
 */
export function ThresholdCard({ t }: { t: Threshold }) {
  const year = String(t.year);
  const tone: Tone = t.crossedMonth ? "critical" : t.crossDate || t.forecast > t.limit ? "warning" : "ok";
  const style = TONE[tone];

  // Шкала с запасом, чтобы и порог, и прогноз помещались.
  const scale = Math.max(t.limit, t.forecast, t.income) * 1.08;
  const incomePct = Math.min(100, (t.income / scale) * 100);
  const forecastPct = Math.min(100, (t.forecast / scale) * 100);
  const limitPct = (t.limit / scale) * 100;
  const historyGap = t.historyFrom && t.historyFrom > `${year}-01` ? `январь–${monthName(prevMonthOf(t.historyFrom))}` : null;

  return (
    <section className={`rounded-2xl border bg-white p-5 sm:p-6 ${tone === "critical" ? "border-red-300" : tone === "warning" ? "border-amber-300" : "border-zinc-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={ui.label}>Доход за {year} год и порог {compactMoney(t.limit)} ₽</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums text-zinc-900">{formatMoney(Math.round(t.income))}</p>
          <p className="text-sm text-zinc-500">
            {t.parts.map((p) => `${p.label} ${compactMoney(p.amount)}`).join(" · ")}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${style.badge}`}>
          <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-full bg-current text-[10px] leading-none">
            <span className="text-white">{style.icon}</span>
          </span>
          {style.label}
        </span>
      </div>

      {/* Шкала: сплошное — уже пришло, штриховка — прогноз до 31 декабря, черта — порог. */}
      <div className="relative mt-8">
        <span className="absolute -top-6 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums text-zinc-900" style={{ left: `${limitPct}%` }}>
          {compactMoney(t.limit)}
        </span>
        <div className="relative h-4 overflow-hidden rounded-full bg-zinc-100">
          {forecastPct > incomePct && (
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${forecastPct}%`,
                backgroundImage: "repeating-linear-gradient(45deg, #CDB2ED 0 3px, transparent 3px 7px)",
              }}
            />
          )}
          <div className="absolute inset-y-0 left-0 rounded-full bg-lavender-600" style={{ width: `${incomePct}%` }} />
        </div>
        <div className="absolute -bottom-1 -top-1 w-[2px] -translate-x-1/2 bg-zinc-900" style={{ left: `${limitPct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-lavender-600" /> пришло с 1 января
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundImage: "repeating-linear-gradient(45deg, #9B7FD1 0 2px, transparent 2px 4px)" }} /> прогноз до 31 декабря
        </span>
      </div>

      <div className="mt-4 space-y-2 text-[15px] leading-relaxed text-zinc-800">
        <p>
          Прогноз на 31 декабря — <b className="tabular-nums">{compactMoney(t.forecast)} ₽</b>
          <span className="text-zinc-500">
            {" "}
            (по темпу последних {t.paceDays} дней: {compactMoney(t.pacePerDay)} ₽ в день{historyGap && !t.extra.amount ? `, без дохода за ${historyGap}` : ""})
          </span>
          .
        </p>
        {t.crossedMonth && t.vatFrom && (
          <p>
            Порог пройден в {inMonth(t.crossedMonth)}. На УСН это значит НДС с <b>{fmtDay(t.vatFrom, year)}</b>.
          </p>
        )}
        {!t.crossedMonth && t.crossDate && t.vatFrom && (
          <p>
            По нынешнему темпу порог будет пройден около <b>{fmtDay(t.crossDate, year)}</b> — тогда на УСН НДС с <b>{fmtDay(t.vatFrom, year)}</b>.
          </p>
        )}
        {tone !== "ok" && (
          <p className="rounded-xl bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-700">
            Обсудите с бухгалтером заранее. На УСН после превышения — НДС с 1-го числа следующего месяца; на патенте — патент теряется. И если доход за {year} год будет больше{" "}
            {compactMoney(t.limit)} ₽, освобождения от НДС не будет и весь {t.year + 1} год: оно считается по доходу прошлого года.
          </p>
        )}
        {!t.limitKnown && <p className="text-sm text-amber-800">Порог на {year} год в программе не обновлён — показан прошлогодний. Уточните у бухгалтера.</p>}
      </div>

      <ExtraIncome t={t} gap={historyGap} />
    </section>
  );
}

function prevMonthOf(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Доход до Posiflora (январь–март 2026) — без него счётчик занижен. */
function ExtraIncome({ t, gap }: { t: Threshold; gap: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(t.needsExtra);
  const [amount, setAmount] = useState(t.extra.amount ? String(t.extra.amount) : "");
  const [note, setNote] = useState(t.extra.note ?? (gap ? gap : ""));
  const [busy, setBusy] = useState(false);

  async function save() {
    const value = Number(amount.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(value) || value < 0) return toast({ tone: "error", text: "Сумма — числом, например 4 500 000" });
    setBusy(true);
    const result = await saveIncomeExtra(t.year, value, note);
    setBusy(false);
    if (!result.success) return toast({ tone: "error", text: result.error });
    toast({ tone: "ok", text: "Сохранено — счётчик пересчитан" });
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <p className="mt-4 text-sm text-zinc-500">
        Доход вне систем за {t.year}: <span className="tabular-nums text-zinc-800">{formatMoney(t.extra.amount)}</span>
        {t.extra.note ? ` (${t.extra.note})` : ""}{" "}
        <button type="button" onClick={() => setOpen(true)} className="font-semibold text-lavender-700 underline underline-offset-2">
          изменить
        </button>
      </p>
    );
  }

  return (
    <div className={`mt-4 rounded-xl p-4 ${t.needsExtra ? "bg-amber-50 ring-1 ring-inset ring-amber-200" : "bg-zinc-50"}`}>
      <p className="text-sm text-zinc-800">
        {gap ? (
          <>
            В Posiflora доход есть только с {t.historyFrom ? fromMonth(t.historyFrom) : "середины года"}. Впишите, сколько пришло за <b>{gap}</b> {t.year} — касса, карта, переводы. Без
            этой суммы счётчик показывает меньше, чем есть на самом деле.
          </>
        ) : (
          <>Доход за {t.year} год, которого нет ни в Posiflora, ни на сайте, ни в Учёте.</>
        )}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="w-44">
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Сумма, ₽</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="например 4 500 000" className={ui.fieldSm} />
        </label>
        <label className="min-w-[180px] flex-1">
          <span className="mb-1 block text-xs font-semibold text-zinc-600">За что</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="январь–март" className={ui.fieldSm} />
        </label>
        <button type="button" disabled={busy} onClick={save} className={ui.btnPrimary}>
          {busy ? "…" : "Сохранить"}
        </button>
        {!t.needsExtra && (
          <button type="button" onClick={() => setOpen(false)} className={ui.btnGhost}>
            Отмена
          </button>
        )}
      </div>
    </div>
  );
}
