"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StockRow } from "@/lib/uchet/queries";
import { daysLabel, daysSince, formatMoney, formatQty } from "@/lib/uchet/format";

type Filter = "all" | "posiflora-positive" | "posiflora-negative" | "stale" | "ours" | "hidden";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Все действующие" },
  { key: "posiflora-positive", label: "Есть в Posiflora" },
  { key: "posiflora-negative", label: "В минусе в Posiflora" },
  { key: "stale", label: "Не двигались 90+ дней" },
  { key: "ours", label: "Есть в нашем учёте" },
  { key: "hidden", label: "Скрытые" },
];

type Sort = "title" | "posiflora" | "moved";

/**
 * Таблица остатков. Фильтрует в браузере: позиций сотни, а не десятки
 * тысяч, и мгновенный поиск на планшете важнее экономии трафика.
 *
 * Две колонки остатка намеренно рядом. Пока продажи идут через Posiflora,
 * наш журнал не знает о расходе, и честно показать можно только оба
 * числа. После перехода колонка Posiflora уйдёт.
 */
export function StockTable({ rows, withCosts }: { rows: StockRow[]; withCosts: boolean }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("title");

  const groups = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => r.groupId && r.groupTitle && m.set(r.groupId, r.groupTitle));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [rows]);

  const counts = useMemo(() => {
    const active = rows.filter((r) => r.isActive);
    return {
      all: active.length,
      "posiflora-positive": active.filter((r) => (r.posifloraQty ?? 0) > 0).length,
      "posiflora-negative": active.filter((r) => (r.posifloraQty ?? 0) < 0).length,
      stale: active.filter((r) => (daysSince(r.lastMovementAt) ?? Infinity) > 90).length,
      ours: active.filter((r) => r.qty !== 0).length,
      hidden: rows.filter((r) => !r.isActive).length,
    } satisfies Record<Filter, number>;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (filter === "hidden" ? r.isActive : !r.isActive) return false;
      if (group && r.groupId !== group) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      switch (filter) {
        case "posiflora-positive":
          return (r.posifloraQty ?? 0) > 0;
        case "posiflora-negative":
          return (r.posifloraQty ?? 0) < 0;
        case "stale":
          return (daysSince(r.lastMovementAt) ?? Infinity) > 90;
        case "ours":
          return r.qty !== 0;
        default:
          return true;
      }
    });

    return list.sort((a, b) => {
      if (sort === "posiflora") return (a.posifloraQty ?? 0) - (b.posifloraQty ?? 0);
      if (sort === "moved") return (b.lastMovementAt ?? "").localeCompare(a.lastMovementAt ?? "");
      return a.title.localeCompare(b.title, "ru");
    });
  }, [rows, query, group, filter, sort]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="stock-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти позицию…"
          aria-label="Поиск по названию"
          className="min-w-0 flex-1 rounded-full border border-lavender-200 bg-white px-5 py-2.5 font-body text-sm text-ink outline-none transition placeholder:text-ink/40 focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 sm:max-w-xs"
        />
        <select
          id="stock-group"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          aria-label="Группа"
          className="rounded-full border border-lavender-200 bg-white px-4 py-2.5 font-body text-sm text-ink outline-none focus:border-gold-400"
        >
          <option value="">Все группы</option>
          {groups.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
        <select
          id="stock-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Сортировка"
          className="rounded-full border border-lavender-200 bg-white px-4 py-2.5 font-body text-sm text-ink outline-none focus:border-gold-400"
        >
          <option value="title">По названию</option>
          <option value="posiflora">Сначала минус в Posiflora</option>
          <option value="moved">Сначала недавно двигавшиеся</option>
        </select>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Фильтр">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`rounded-full px-3.5 py-1.5 font-display text-xs font-semibold transition ${
              filter === f.key
                ? "bg-ink text-white"
                : f.key === "posiflora-negative" && counts[f.key] > 0
                  ? "bg-red-50 text-red-700 hover:bg-red-100"
                  : "bg-lavender-50 text-ink/70 hover:bg-lavender-100"
            }`}
          >
            {f.label} · {counts[f.key]}
          </button>
        ))}
      </div>

      <div className="mt-5 overflow-hidden rounded-3xl border border-lavender-100 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-lavender-100 bg-lavender-50/60">
                <th className="px-5 py-3 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Позиция</th>
                <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">У нас</th>
                <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Posiflora</th>
                <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Двигалась</th>
                <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Цена</th>
                {withCosts && (
                  <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Себест.
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 400).map((r) => {
                const moved = daysSince(r.lastMovementAt);
                const stale =
                  r.freshDays !== null && r.oldestBatchDays !== null && r.oldestBatchDays >= r.freshDays;
                const low = r.minQty !== null && r.qty < r.minQty;
                return (
                  <tr key={r.id} className="border-b border-lavender-50 last:border-0 hover:bg-lavender-50/40">
                    <td className="px-5 py-3">
                      <Link href={`/admin/sklad/items/${r.id}`} className="font-body text-sm font-medium text-ink hover:text-gold-700">
                        {r.title}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 font-body text-xs text-ink/45">
                        <span>{r.groupTitle ?? "без группы"}</span>
                        {!r.isTracked && <span>· без учёта остатка</span>}
                        {stale && <span className="text-amber-700">· лежит {r.oldestBatchDays} дн.</span>}
                        {low && <span className="text-amber-700">· ниже минимума</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink">
                      {r.isTracked ? `${formatQty(r.qty)} ${r.unit}` : "—"}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono text-sm tabular-nums ${
                        (r.posifloraQty ?? 0) < 0 ? "font-semibold text-red-700" : "text-ink/70"
                      }`}
                    >
                      {r.posifloraQty === null ? "—" : formatQty(r.posifloraQty)}
                    </td>
                    <td className={`px-4 py-3 font-body text-xs ${moved !== null && moved <= 30 ? "text-ink/70" : "text-ink/40"}`}>
                      {daysLabel(moved)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink/70">
                      {r.salePrice ? formatMoney(r.salePrice) : "—"}
                    </td>
                    {withCosts && (
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink/70">
                        {r.avgCost ? formatMoney(r.avgCost) : r.posifloraUnitCost ? (
                          <span title="Оценка по движениям Posiflora">≈ {formatMoney(r.posifloraUnitCost)}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visible.length === 0 && (
          <p className="px-6 py-14 text-center font-body text-sm text-ink/50">Ничего не нашлось — попробуйте другой фильтр.</p>
        )}
        {visible.length > 400 && (
          <p className="border-t border-lavender-100 px-6 py-4 font-body text-xs text-ink/50">
            Показаны первые 400 из {visible.length}. Уточните поиск или группу.
          </p>
        )}
      </div>
    </div>
  );
}
