"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { bulkUpdateItems } from "@/lib/uchet/actions";
import type { GroupOption, ReasonOption, StockRow } from "@/lib/uchet/queries";
import { daysLabel, daysSince, formatMoney, formatQty } from "@/lib/uchet/format";
import { KIND_STYLE, ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { ItemDrawer } from "@/components/uchet/sklad/ItemDrawer";

type Chip = "all" | "instock" | "low" | "negative" | "stale" | "noprice" | "hidden";
type SortKey = "title" | "qty" | "price" | "cost" | "value" | "moved";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const CHIPS: { key: Chip; label: string; tone?: "warn" | "bad" }[] = [
  { key: "all", label: "Все" },
  { key: "instock", label: "В наличии" },
  { key: "low", label: "Мало", tone: "warn" },
  { key: "negative", label: "В минусе", tone: "bad" },
  { key: "stale", label: "Залежалось", tone: "warn" },
  { key: "noprice", label: "Без цены" },
  { key: "hidden", label: "Скрытые" },
];

const SORT_STORAGE = "uchet.sklad.sort";
const STALE_DAYS = 90;
const MAX_PREFILL = 150;

type Props = {
  rows: StockRow[];
  groups: GroupOption[];
  reasons: ReasonOption[];
  withCosts: boolean;
  isTraining: boolean;
};

/**
 * Склад: найти позицию и сделать с ней что-то, не уходя со списка.
 *
 * Пока учёт не запущен, главная цифра — остаток Posiflora: это реальность
 * магазина. После запуска главной станет наш журнал, а Posiflora уйдёт в
 * подпись. Экран переключается сам, по месту хранения по умолчанию.
 */
export function StockView({ rows, groups, reasons, withCosts, isTraining }: Props) {
  const router = useRouter();
  const toast = useToast();

  const [group, setGroup] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "title", dir: "asc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulkGroup, setBulkGroup] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Сортировку помним между заходами: у каждого свой привычный порядок.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_STORAGE);
      if (saved) setSort(JSON.parse(saved) as Sort);
    } catch {
      // хранилище недоступно — живём с порядком по умолчанию
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SORT_STORAGE, JSON.stringify(sort));
    } catch {
      // ничего страшного
    }
  }, [sort]);

  const mainQty = (r: StockRow) => (isTraining ? r.posifloraQty ?? 0 : r.qty);
  const costOf = (r: StockRow) => (r.avgCost && r.avgCost > 0 ? r.avgCost : r.posifloraUnitCost ?? 0);
  const isStale = (r: StockRow) =>
    (r.freshDays !== null && r.oldestBatchDays !== null && r.oldestBatchDays >= r.freshDays) ||
    (mainQty(r) > 0 && (daysSince(r.lastMovementAt) ?? Infinity) > STALE_DAYS);

  const matchesChip = (r: StockRow, c: Chip) => {
    if (c === "hidden") return !r.isActive;
    if (!r.isActive) return false;
    switch (c) {
      case "instock":
        return mainQty(r) > 0;
      case "low":
        return r.minQty !== null && mainQty(r) < r.minQty;
      case "negative":
        return mainQty(r) < 0;
      case "stale":
        return isStale(r);
      case "noprice":
        return r.isTracked && !r.salePrice;
      default:
        return true;
    }
  };

  // Счётчики на плитках групп и на фильтрах — по тому, что уже отфильтровано
  // остальным, чтобы число на кнопке совпадало с тем, что откроется.
  const chipCounts = useMemo(() => {
    const base = rows.filter((r) => !group || r.groupId === group);
    return Object.fromEntries(CHIPS.map((c) => [c.key, base.filter((r) => matchesChip(r, c.key)).length])) as Record<Chip, number>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, group, isTraining]);

  const groupTiles = useMemo(() => {
    return groups
      .filter((g) => g.isActive)
      .map((g) => {
        const inGroup = rows.filter((r) => r.groupId === g.id && matchesChip(r, chip === "hidden" ? "hidden" : "all"));
        return { ...g, count: inGroup.length, negative: inGroup.filter((r) => mainQty(r) < 0).length };
      })
      .filter((g) => g.count > 0)
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, rows, chip, isTraining]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => (!group || r.groupId === group) && matchesChip(r, chip) && (!q || r.title.toLowerCase().includes(q)));
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (r: StockRow): number | string => {
      switch (sort.key) {
        case "qty":
          return mainQty(r);
        case "price":
          return r.salePrice ?? -1;
        case "cost":
          return costOf(r);
        case "value":
          return Math.max(mainQty(r), 0) * costOf(r);
        case "moved":
          return r.lastMovementAt ?? "";
        default:
          return r.title.toLowerCase();
      }
    };
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (typeof x === "string" && typeof y === "string") return x.localeCompare(y, "ru") * dir;
      return ((x as number) - (y as number)) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, group, chip, query, sort, isTraining]);

  const totalValue = withCosts ? visible.reduce((s, r) => s + Math.max(mainQty(r), 0) * costOf(r), 0) : null;
  const openRow = openId ? rows.find((r) => r.id === openId) ?? null : null;

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "title" ? "asc" : "desc" }));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.id)));
  }

  async function bulk(patch: { groupId?: string | null; isActive?: boolean }, done: string) {
    setBulkBusy(true);
    const result = await bulkUpdateItems([...selected], patch);
    setBulkBusy(false);
    if (!result.success) return toast({ tone: "error", text: result.error });
    toast({ tone: "ok", text: `${done}: ${result.data.count}` });
    setSelected(new Set());
    router.refresh();
  }

  function openDocWithSelected(type: "inventory" | "writeoff" | "receipt") {
    const ids = [...selected].slice(0, MAX_PREFILL);
    if (selected.size > MAX_PREFILL) toast({ tone: "error", text: `В документ попадут первые ${MAX_PREFILL} позиций` });
    router.push(`/uchet/sklad/docs/new?type=${type}&items=${ids.join(",")}`);
  }

  const SortHead = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`${ui.th} ${right ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 uppercase hover:text-zinc-900 ${sort.key === k ? "text-zinc-900" : ""}`}
      >
        {children}
        {sort.key === k && <span aria-hidden="true">{sort.dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );

  return (
    <div>
      {/* Плитки групп — цвет по виду, крупные, на одно касание. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="group" aria-label="Группы">
        <button
          type="button"
          onClick={() => setGroup("")}
          aria-pressed={!group}
          className={`flex min-h-[64px] min-w-[104px] shrink-0 flex-col justify-between rounded-xl px-3.5 py-2.5 text-left ring-1 ring-inset transition ${
            !group ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-800 ring-zinc-200 hover:ring-zinc-300"
          }`}
        >
          <span className="text-sm font-semibold">Все группы</span>
          <span className="text-xs opacity-60 tabular-nums">{rows.filter((r) => matchesChip(r, chip === "hidden" ? "hidden" : "all")).length}</span>
        </button>
        {groupTiles.map((g) => {
          const style = KIND_STYLE[g.kind];
          const on = group === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(on ? "" : g.id)}
              aria-pressed={on}
              className={`flex min-h-[64px] min-w-[120px] shrink-0 flex-col justify-between rounded-xl px-3.5 py-2.5 text-left ring-1 ring-inset transition ${
                on ? "bg-zinc-900 text-white ring-zinc-900" : `${style.tile} hover:brightness-[0.98]`
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                <span className="truncate">{g.title}</span>
              </span>
              <span className="flex items-center gap-2 text-xs tabular-nums">
                <span className="opacity-60">{g.count}</span>
                {g.negative > 0 && (
                  <span className={`rounded px-1 font-semibold ${on ? "bg-red-500 text-white" : "bg-red-100 text-red-700"}`}>−{g.negative}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Поиск и готовые фильтры */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          id="stock-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти позицию…"
          aria-label="Поиск по названию"
          className={`${ui.field} min-w-0 flex-1 sm:max-w-xs`}
        />
        {CHIPS.map((c) => {
          const n = chipCounts[c.key];
          const on = chip === c.key;
          const warn = !on && n > 0 && c.tone;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setChip(c.key)}
              aria-pressed={on}
              className={`${ui.chip} ${
                on ? ui.chipOn : warn === "bad" ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200" : warn === "warn" ? "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200" : ui.chipOff
              }`}
            >
              {c.label}
              <span className="tabular-nums opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Таблица */}
      <div className={`${ui.card} mt-4 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-zinc-200 bg-zinc-50">
              <tr>
                {withCosts && (
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Отметить все видимые"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 accent-lavender-600"
                    />
                  </th>
                )}
                <th className="w-14 px-3 py-2.5" aria-label="Фото" />
                <SortHead k="title">Позиция</SortHead>
                <SortHead k="qty" right>
                  {isTraining ? "Остаток" : "Остаток"}
                </SortHead>
                <SortHead k="price" right>
                  Цена
                </SortHead>
                {withCosts && (
                  <SortHead k="cost" right>
                    Себест.
                  </SortHead>
                )}
                {withCosts && (
                  <SortHead k="value" right>
                    На сумму
                  </SortHead>
                )}
                <SortHead k="moved">Двигалась</SortHead>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const q = mainQty(r);
                const style = r.kind ? KIND_STYLE[r.kind] : KIND_STYLE.other;
                const low = r.minQty !== null && q < r.minQty;
                const stale = isStale(r);
                const moved = daysSince(r.lastMovementAt);
                const cost = costOf(r);
                return (
                  <tr
                    key={r.id}
                    onClick={() => setOpenId(r.id)}
                    className={`cursor-pointer border-b border-zinc-100 last:border-0 transition hover:bg-lavender-50/50 ${openId === r.id ? "bg-lavender-50" : ""} ${!r.isActive ? "opacity-60" : ""}`}
                  >
                    {withCosts && (
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Отметить «${r.title}»`}
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          className="h-4 w-4 accent-lavender-600"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="relative h-10 w-10 overflow-hidden rounded-lg bg-zinc-100">
                        {r.photoUrl ? (
                          <Image src={r.photoUrl} alt="" fill sizes="40px" className="object-cover" />
                        ) : (
                          <span className={`absolute inset-0 m-auto h-2.5 w-2.5 rounded-full ${style.dot}`} aria-hidden="true" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-sm font-medium text-zinc-900">{r.title}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-zinc-500">
                        <span>{r.groupTitle ?? "без группы"}</span>
                        {low && <span className="font-medium text-amber-700">мало</span>}
                        {stale && <span className="font-medium text-amber-700">залежалось</span>}
                        {!r.isTracked && <span>без остатка</span>}
                      </p>
                    </td>
                    <td className={`px-3 py-2 text-right text-sm tabular-nums ${q < 0 ? "font-semibold text-red-600" : "text-zinc-900"}`}>
                      {r.isTracked ? (
                        <>
                          {formatQty(q)} <span className="text-xs text-zinc-400">{r.unit}</span>
                          {isTraining && r.qty !== 0 && <span className="block text-[11px] font-normal text-amber-700">трен. {formatQty(r.qty)}</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums text-zinc-700">{r.salePrice ? formatMoney(r.salePrice) : <span className="text-zinc-300">—</span>}</td>
                    {withCosts && <td className="px-3 py-2 text-right text-sm tabular-nums text-zinc-600">{cost ? formatMoney(cost) : "—"}</td>}
                    {withCosts && (
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-zinc-600">
                        {q > 0 && cost ? formatMoney(Math.round(q * cost)) : "—"}
                      </td>
                    )}
                    <td className={`px-3 py-2 text-xs ${moved !== null && moved <= 30 ? "text-zinc-600" : "text-zinc-400"}`}>{daysLabel(moved)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visible.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-zinc-500">Ничего не нашлось — смените группу или фильтр.</p>
        ) : (
          <p className="border-t border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-500">
            Показано {visible.length}
            {totalValue !== null && totalValue > 0 && (
              <>
                {" "}
                · на сумму <span className="font-semibold tabular-nums text-zinc-700">{formatMoney(Math.round(totalValue))}</span> по себестоимости
              </>
            )}
          </p>
        )}
      </div>

      {/* Полоса действий над отмеченными */}
      {withCosts && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-6 md:left-[84px]">
          <div className="flex max-w-full flex-wrap items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-2xl">
            <span className="font-semibold tabular-nums">Отмечено {selected.size}</span>
            <span className="mx-1 h-5 w-px bg-white/20" aria-hidden="true" />
            <select
              id="bulk-group"
              aria-label="Сменить группу"
              value={bulkGroup}
              onChange={(e) => setBulkGroup(e.target.value)}
              className="rounded-lg bg-white/10 px-2.5 py-1.5 text-sm text-white outline-none"
            >
              <option value="" className="text-zinc-900">Сменить группу…</option>
              {groups.filter((g) => g.isActive).map((g) => (
                <option key={g.id} value={g.id} className="text-zinc-900">
                  {g.title}
                </option>
              ))}
            </select>
            <button type="button" disabled={!bulkGroup || bulkBusy} onClick={() => bulk({ groupId: bulkGroup }, "Перенесено")} className="rounded-lg bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20 disabled:opacity-40">
              Перенести
            </button>
            <button type="button" disabled={bulkBusy} onClick={() => bulk({ isActive: false }, "Скрыто")} className="rounded-lg bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20">
              Скрыть
            </button>
            <button type="button" disabled={bulkBusy} onClick={() => bulk({ isActive: true }, "Возвращено")} className="rounded-lg bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20">
              Вернуть
            </button>
            <button type="button" onClick={() => openDocWithSelected("inventory")} className="rounded-lg bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20">
              Пересчитать
            </button>
            <button type="button" onClick={() => openDocWithSelected("writeoff")} className="rounded-lg bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20">
              Списать
            </button>
            <button type="button" onClick={() => openDocWithSelected("receipt")} className="rounded-lg bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20">
              Приход
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1.5 text-white/60 hover:text-white" aria-label="Снять отметку">
              ✕
            </button>
          </div>
        </div>
      )}

      {openRow && (
        <ItemDrawer
          row={openRow}
          groups={groups}
          reasons={reasons}
          withCosts={withCosts}
          isTraining={isTraining}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
