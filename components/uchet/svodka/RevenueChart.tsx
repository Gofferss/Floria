"use client";

import { useState } from "react";
import type { SeriesPoint } from "@/lib/uchet/summary";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { compactMoney, fmtMonthShort, fmtPoint, niceTicks } from "./fmt";

/**
 * Выручка по дням (или по месяцам за год). Один ряд — один цвет, без
 * легенды: что это, говорит заголовок. Подробности дня — в подсказке по
 * наведению или касанию; там же прибыль, чтобы не рисовать второй ряд.
 * Сегодняшний столбик светлее: день ещё идёт.
 */
export function RevenueChart({ points, step, today }: { points: SeriesPoint[]; step: "day" | "month"; today: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const max = Math.max(0, ...points.map((p) => p.revenue));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const isNow = (p: SeriesPoint) => (step === "day" ? p.date === today : p.date.slice(0, 7) === today.slice(0, 7));
  const withProfit = points.some((p) => p.profit !== null);

  // Подписи под столбиками — не под каждым, а чтобы не слипались.
  const labelAt = (i: number) => {
    if (step === "month" || points.length <= 10) return true;
    const d = Number(points[i].date.slice(8, 10));
    return d === 1 || d % 5 === 0;
  };
  const label = (p: SeriesPoint) => (step === "month" ? fmtMonthShort(p.date) : points.length <= 10 ? fmtPoint(p.date, "day").split(",")[0] : String(Number(p.date.slice(8, 10))));

  const tip = active !== null ? points[active] ?? null : null;
  // Сбоку от столбика, а не над ним: так подсказка не закрывает сам
  // столбик и не вылезает за край карточки.
  const tipStyle =
    active === null
      ? undefined
      : active + 0.5 < points.length / 2
        ? { left: `calc(${((active + 1) / points.length) * 100}% + 6px)` }
        : { left: `calc(${(active / points.length) * 100}% - 6px)`, transform: "translateX(-100%)" };

  return (
    <section className={ui.cardPad}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={ui.h2}>Выручка {step === "month" ? "по месяцам" : "по дням"}</h2>
        <button type="button" onClick={() => setAsTable((v) => !v)} className={ui.btnGhost}>
          {asTable ? "Графиком" : "Таблицей"}
        </button>
      </div>

      {asTable ? (
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th className={ui.th}>{step === "month" ? "Месяц" : "День"}</th>
                <th className={`${ui.th} text-right`}>Выручка</th>
                {withProfit && <th className={`${ui.th} text-right`}>Прибыль</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {points.map((p) => (
                <tr key={p.date}>
                  <td className={ui.td}>
                    {fmtPoint(p.date, step)}
                    {isNow(p) && <span className="text-zinc-400"> · ещё идёт</span>}
                  </td>
                  <td className={`${ui.td} whitespace-nowrap text-right tabular-nums`}>{formatMoney(p.revenue)}</td>
                  {withProfit && <td className={`${ui.td} whitespace-nowrap text-right tabular-nums text-zinc-600`}>{p.profit === null ? "—" : formatMoney(Math.round(p.profit))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-4 select-none" onMouseLeave={() => setActive(null)}>
          {/* Сетка и подписи оси — приглушённые, чтобы смотрелись столбики. */}
          <div className="relative ml-12 h-52">
            {ticks.map((t) => (
              <div key={t} className="pointer-events-none absolute inset-x-0 border-t border-zinc-100" style={{ bottom: `${(t / top) * 100}%` }}>
                <span className="absolute -left-12 -translate-y-1/2 text-[11px] tabular-nums text-zinc-400">{compactMoney(t)}</span>
              </div>
            ))}
            <div className="absolute inset-0 flex items-end gap-[2px] border-b border-zinc-300">
              {points.map((p, i) => {
                const h = (p.revenue / top) * 100;
                return (
                  <button
                    key={p.date}
                    type="button"
                    aria-label={`${fmtPoint(p.date, step)}: ${formatMoney(p.revenue)}`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    // Касание только открывает: на телефоне перед кликом уже сработало
                    // «наведение», и переключатель тут же закрыл бы подсказку.
                    onClick={() => setActive(i)}
                    className="flex h-full min-w-0 flex-1 items-end justify-center outline-none focus-visible:ring-2 focus-visible:ring-lavender-500/40"
                  >
                    <span
                      className={`block w-full max-w-[44px] rounded-t-[4px] transition-colors ${
                        p.revenue <= 0 ? "bg-zinc-200" : active === i ? "bg-lavender-700" : isNow(p) ? "bg-lavender-300" : "bg-lavender-600"
                      }`}
                      style={{ height: p.revenue > 0 ? `max(${h}%, 2px)` : "2px" }}
                    />
                  </button>
                );
              })}
            </div>

            {tip && (
              <div
                className="pointer-events-none absolute top-0 z-10 w-max max-w-[220px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg"
                style={tipStyle}
              >
                <p className="font-semibold text-zinc-900">{fmtPoint(tip.date, step)}</p>
                <p className="tabular-nums text-zinc-800">Выручка {formatMoney(tip.revenue)}</p>
                {tip.profit !== null && <p className="tabular-nums text-zinc-600">Прибыль {formatMoney(Math.round(tip.profit))}</p>}
                {isNow(tip) && <p className="text-xs text-zinc-400">{step === "month" ? "месяц ещё идёт" : "день ещё идёт"}</p>}
              </div>
            )}
          </div>

          <div className="ml-12 mt-1.5 flex gap-[2px]">
            {points.map((p, i) => (
              // Столбик на телефоне уже подписи «20» — подпись выходит за него, оставаясь по центру.
              <span key={p.date} className="relative h-4 min-w-0 flex-1">
                {labelAt(i) && (
                  <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-zinc-500">{label(p)}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
