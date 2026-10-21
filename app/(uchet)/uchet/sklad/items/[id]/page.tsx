import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffUser } from "@/lib/auth/server";
import { canSeeCosts } from "@/lib/uchet/access";
import { getItemEditable, getStockItem, listGroups, listItemMovements, listUnits } from "@/lib/uchet/queries";
import { DOC_TYPE_LABEL, daysLabel, daysSince, formatDateTime, formatMoney, formatQty } from "@/lib/uchet/format";
import { SkladHeader } from "@/components/uchet/sklad/SkladHeader";
import { ItemForm } from "@/components/uchet/sklad/ItemForm";

export const metadata: Metadata = {
  title: "Позиция склада",
};

export const dynamic = "force-dynamic";

export default async function SkladItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaffUser("/uchet/sklad");
  const withCosts = canSeeCosts(staff.role);

  const [editable, stock, movements, groups, units] = await Promise.all([
    getItemEditable(id),
    getStockItem(id, withCosts),
    listItemMovements(id, withCosts),
    listGroups(),
    listUnits(),
  ]);
  if (!editable || !stock) notFound();

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8">
      <SkladHeader active="stock" title={editable.title} />

      <Link href="/uchet/sklad" className="font-body text-sm text-ink/55 underline decoration-lavender-300 underline-offset-4 hover:text-ink">
        ← Все остатки
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <ItemForm item={editable} groups={groups} units={units} />

        <aside className="flex flex-col gap-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Остаток у нас</h2>
            <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">
              {stock.isTracked ? `${formatQty(stock.qty)} ${stock.unit}` : "не ведётся"}
            </p>
            {stock.oldestBatchDays !== null && (
              <p className="mt-1 font-body text-xs text-ink/55">самая старая партия лежит {stock.oldestBatchDays} дн.</p>
            )}
            {withCosts && (
              <p className="mt-3 font-body text-sm text-ink/70">
                Себестоимость: <span className="font-mono">{stock.avgCost ? formatMoney(stock.avgCost) : "—"}</span>
              </p>
            )}
            <p className="mt-3 font-body text-xs text-ink/45">Меняется только документами — приходом, списанием, инвентаризацией.</p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6">
            <h2 className="font-display text-xs font-semibold uppercase tracking-wide text-ink/50">В Posiflora</h2>
            <p
              className={`mt-2 font-mono text-3xl font-semibold tabular-nums ${
                (stock.posifloraQty ?? 0) < 0 ? "text-red-700" : "text-ink"
              }`}
            >
              {stock.posifloraQty === null ? "—" : formatQty(stock.posifloraQty)}
            </p>
            {(stock.posifloraQty ?? 0) < 0 && (
              <p className="mt-1 font-body text-xs text-red-700">
                Продано больше, чем пришло. Обычно значит, что закупку не провели приходом.
              </p>
            )}
            <ul className="mt-3 space-y-1 font-body text-sm text-ink/70">
              <li>Двигалась: {daysLabel(daysSince(stock.lastMovementAt))}</li>
              {withCosts && stock.posifloraUnitCost !== null && <li>Себестоимость: ≈ {formatMoney(stock.posifloraUnitCost)}</li>}
              {(stock.posifloraTrainingQty ?? 0) !== 0 && (
                <li>На тренировочном складе: {formatQty(stock.posifloraTrainingQty)}</li>
              )}
            </ul>
            <p className="mt-3 font-body text-xs text-ink/45">Снимок {formatDateTime(stock.snapshotAt)}</p>
          </div>
        </aside>
      </div>

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold text-ink">Движения</h2>
        {movements.length === 0 ? (
          <p className="mt-3 font-body text-sm text-ink/55">
            В нашем учёте движений ещё нет. История Posiflora по этой позиции осталась в Posiflora.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50">
                    <th className="px-5 py-3 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Документ</th>
                    <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Дата</th>
                    <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Изменение</th>
                    {withCosts && (
                      <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Сумма</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m, i) => (
                    <tr key={`${m.documentId}-${i}`} className="border-b border-zinc-100 last:border-0">
                      <td className="px-5 py-3">
                        <Link href={`/uchet/sklad/docs/${m.documentId}`} className="font-body text-sm font-medium text-ink hover:text-lavender-700">
                          {m.docNo}
                        </Link>
                        <span className="ml-2 font-body text-xs text-ink/50">
                          {DOC_TYPE_LABEL[m.docType]}
                          {m.isReversal ? " · сторно" : m.status === "reversed" ? " · сторнирован" : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-body text-sm text-ink/70">{formatDateTime(m.date)}</td>
                      <td
                        className={`px-4 py-3 text-right font-mono text-sm tabular-nums ${
                          (m.qtyDelta ?? 0) < 0 ? "text-red-700" : "text-green-700"
                        }`}
                      >
                        {(m.qtyDelta ?? 0) > 0 ? "+" : ""}
                        {formatQty(m.qtyDelta)}
                      </td>
                      {withCosts && (
                        <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink/70">{formatMoney(m.amount)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
