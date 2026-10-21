import { isFailed, monthTitle, type FailedBlock, type SourceBlock, type Summary } from "@/lib/uchet/summary";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { fmtPct, fmtRange } from "./fmt";
import { PeriodBar } from "./PeriodBar";
import { RevenueChart } from "./RevenueChart";
import { ThresholdCard } from "./ThresholdCard";
import { PaymentShares } from "./PaymentShares";
import { SourceNote } from "./SourceNote";

const SOURCE_TITLE = { posiflora: "Posiflora", uchet: "Учёт" } as const;

function checksWord(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  if (last === 1 && tens !== 11) return "чек";
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return "чека";
  return "чеков";
}

function Change({ value, against }: { value: number | null | undefined; against: string }) {
  if (value === null || value === undefined) return null;
  const up = value > 0;
  return (
    <p className={`mt-1 text-sm font-medium tabular-nums ${up ? "text-emerald-700" : "text-red-700"}`} title={`Изменение ${against}`}>
      <span aria-hidden>{up ? "▲" : "▼"}</span> {fmtPct(value)} <span className="font-normal text-zinc-500">{against}</span>
    </p>
  );
}

function Kpi({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className={`${ui.card} p-4 sm:p-6`}>
      <p className={ui.label}>{label}</p>
      <p className="mt-1 whitespace-nowrap font-display text-[19px] font-bold tabular-nums text-zinc-900 sm:text-[28px]">{value}</p>
      {children}
    </div>
  );
}

function Failed({ block, today }: { block: FailedBlock; today: string }) {
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
      <p className="font-semibold">
        Цифры {SOURCE_TITLE[block.source]} за {fmtRange(block.from, block.to, today)} не загрузились.
      </p>
      <p className="mt-1 text-sm">Это не ноль продаж. Обновите страницу через минуту; если повторится — напишите, текст ошибки ниже.</p>
      <p className="mt-2 break-all text-xs text-red-800/80">{block.error.slice(0, 300)}</p>
    </section>
  );
}

/**
 * Сводка для владельцев. Сверху — доход за год против порога 20 млн ₽:
 * это решение с датой и деньгами, его нельзя прятать. Дальше — период:
 * четыре главные цифры, выручка по дням, как платили, кто продавал, что
 * списали.
 */
export function SummaryView({ summary }: { summary: Summary }) {
  const { period, today, blocks, site, reconcile, threshold } = summary;
  const ok = blocks.filter((b): b is SourceBlock => !isFailed(b));
  const failed = blocks.filter(isFailed);
  const single = blocks.length === 1 && ok.length === 1 ? ok[0] : null;

  const thisMonth = today.slice(0, 7);
  const prev = Number(thisMonth.slice(5, 7)) === 1 ? `${Number(thisMonth.slice(0, 4)) - 1}-12` : `${thisMonth.slice(0, 4)}-${String(Number(thisMonth.slice(5, 7)) - 1).padStart(2, "0")}`;
  const chips = [
    { key: "today", href: "/uchet/svodka?p=today", label: "Сегодня" },
    { key: "week", href: "/uchet/svodka?p=week", label: "7 дней" },
    { key: "month", href: "/uchet/svodka", label: monthTitle(thisMonth) },
    { key: "prev", href: "/uchet/svodka?p=prev", label: monthTitle(prev) },
    { key: "year", href: "/uchet/svodka?p=year", label: "С начала года" },
  ];

  // Сайт — отдельный источник денег: в Posiflora у его заказов сумма 0.
  const revenue = ok.reduce((s, b) => s + b.revenue, 0) + site.amount;
  const checks = ok.reduce((s, b) => s + b.checks, 0) + site.count;
  const profitBlocks = ok.filter((b) => b.profit !== null);
  const profit = profitBlocks.length ? profitBlocks.reduce((s, b) => s + (b.profit ?? 0), 0) : null;
  const against = period.key === "today" ? "к вчера" : "к прошлому периоду";
  const sameStep = ok.length > 0 && ok.every((b) => b.series.step === ok[0].series.step);
  const points = sameStep ? ok.flatMap((b) => b.series.points) : ok[0]?.series.points ?? [];
  const step = ok[0]?.series.step ?? "day";

  return (
    <div className={`${ui.page} space-y-5`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={ui.h1}>Сводка</h1>
          <p className={ui.muted}>
            {fmtRange(period.from, period.to, today)} · {[...new Set(blocks.map((b) => SOURCE_TITLE[b.source]))].join(" и ")}
            {site.count > 0 ? " и сайт" : ""}
          </p>
        </div>
        <PeriodBar period={period} chips={chips} today={today} />
      </div>

      {"error" in threshold ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
          <p className="font-semibold">Счётчик дохода за год не посчитался.</p>
          <p className="mt-1">Обновите страницу через минуту. Ошибка: {threshold.error.slice(0, 200)}</p>
        </section>
      ) : (
        <ThresholdCard t={threshold} />
      )}

      {failed.map((b) => (
        <Failed key={`${b.source}${b.from}`} block={b} today={today} />
      ))}

      {ok.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Выручка" value={formatMoney(Math.round(revenue))}>
              {single && <Change value={single.change?.revenue} against={against} />}
              {site.amount > 0 && (
                <p className="mt-1 text-xs text-zinc-500">
                  в т.ч. сайт онлайн {formatMoney(site.amount)}
                </p>
              )}
            </Kpi>
            <Kpi label="Чеков" value={checks.toLocaleString("ru-RU")}>
              {single && <Change value={single.change?.checks} against={against} />}
            </Kpi>
            <Kpi label="Средний чек" value={formatMoney(checks ? Math.round(revenue / checks) : 0)}>
              {single && <Change value={single.change?.avgCheck} against={against} />}
            </Kpi>
            <Kpi label="Прибыль" value={profit === null ? "—" : formatMoney(Math.round(profit))}>
              {single?.marginPct ? (
                <p className="mt-1 text-sm text-zinc-500">{single.marginPct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% от выручки · ориентир</p>
              ) : profit === null ? (
                <p className="mt-1 text-sm text-zinc-500">по Учёту — когда закупка пойдёт приходом</p>
              ) : null}
            </Kpi>
          </div>

          {single && (single.discount || single.returns?.qty) ? (
            <p className="text-sm text-zinc-500">
              {single.discount ? `Скидки ${formatMoney(Math.round(single.discount))}` : ""}
              {single.discount && single.returns?.qty ? " · " : ""}
              {single.returns?.qty ? `возвраты: ${single.returns.qty} ${checksWord(single.returns.qty)} на ${formatMoney(single.returns.amount)}` : ""}
            </p>
          ) : null}

          {reconcile && (
            <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-700">
              Для сверки: в Учёте за этот период {reconcile.checks} {checksWord(reconcile.checks)} на <b className="tabular-nums">{formatMoney(reconcile.revenue)}</b>. В
              сводку не добавлено — сводка считает по Posiflora.
            </p>
          )}

          {points.length >= 2 && <RevenueChart points={points} step={step} today={today} />}

          {ok.map((b) => (
            <div key={`${b.source}${b.from}`} className="space-y-3">
              {ok.length > 1 && (
                <h2 className={ui.label}>
                  {SOURCE_TITLE[b.source]} · {fmtRange(b.from, b.to, today)}
                </h2>
              )}
              <div className="grid gap-5 lg:grid-cols-3">
                <PaymentShares payments={b.payments} canName={b.source === "posiflora"} />
                <Workers block={b} />
                <Writeoffs block={b} />
              </div>
            </div>
          ))}
        </>
      )}

      <SourceNote since={summary.uchetSince} canSwitch={summary.canSwitch} today={today} />
    </div>
  );
}

function Workers({ block }: { block: SourceBlock }) {
  return (
    <section className={ui.cardPad}>
      <h2 className={ui.h2}>Кто продавал</h2>
      {block.workers.length === 0 ? (
        <p className={`${ui.muted} mt-3`}>Продаж за период нет.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {block.workers.map((w) => (
            <li key={w.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-zinc-900">{w.name}</span>
                <span className="shrink-0 tabular-nums text-zinc-800">
                  {formatMoney(Math.round(w.amount))} <span className="text-zinc-500">· {w.share.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</span>
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-zinc-100">
                <div className="h-2 rounded-full bg-lavender-600" style={{ width: `${Math.max(1, Math.min(100, w.share))}%` }} />
              </div>
              {w.avgCheck ? <p className="mt-0.5 text-xs text-zinc-500">средний чек {formatMoney(Math.round(w.avgCheck))}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Writeoffs({ block }: { block: SourceBlock }) {
  const total = block.writeoffs.reduce((s, w) => s + w.amount, 0);
  return (
    <section className={ui.cardPad}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={ui.h2}>Списано</h2>
        {total > 0 && <span className="text-sm font-semibold tabular-nums text-zinc-900">{formatMoney(Math.round(total))}</span>}
      </div>
      {block.source === "uchet" ? (
        <p className={`${ui.muted} mt-3`}>Списания по Учёту — в разделе «Склад», документы списания.</p>
      ) : block.writeoffs.length === 0 ? (
        <p className={`${ui.muted} mt-3`}>Списаний за период нет.</p>
      ) : (
        <table className="mt-2 w-full">
          <tbody className="divide-y divide-zinc-100">
            {block.writeoffs.map((w) => (
              <tr key={w.reason}>
                <td className="py-2 pr-3 text-sm text-zinc-800">{w.reason}</td>
                <td className="py-2 text-right text-sm tabular-nums text-zinc-900">{formatMoney(Math.round(w.amount))}</td>
                <td className="w-24 py-2 pl-3 text-right text-xs tabular-nums text-zinc-500">
                  {w.shareOfSales ? (w.shareOfSales < 0.1 ? "<0,1% продаж" : `${w.shareOfSales.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% продаж`) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {block.source === "posiflora" && total > 0 && (
        <p className="mt-3 text-xs text-zinc-500">По себестоимости Posiflora; в процентах — от выручки за период.</p>
      )}
    </section>
  );
}
