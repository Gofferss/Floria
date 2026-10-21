"use client";

import Image from "next/image";
import type { KassaGroup, KassaItem, VitrineBouquet } from "@/lib/uchet/pos-queries";
import { formatMoney, formatQty } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { GroupIcon } from "@/components/uchet/GroupIcon";

// ================================================================
// Левая половина кассы — что можно положить в чек.
//
// Цвет — только у того, что требует внимания: красная полоска — нет или
// в минусе (продать всё равно можно: продажу не блокируем ради цифры),
// жёлтая — мало, жёлтая метка «5 дн.» — лежит дольше срока свежести и
// должна уйти в работу первой. Группы различаются значком.
// ================================================================

type State = "" | "low" | "neg";

function stockState(i: KassaItem): State {
  if (!i.isTracked) return "";
  if (i.qty <= 0) return "neg";
  if (i.minQty !== null && i.qty < i.minQty) return "low";
  return "";
}

function isOld(i: KassaItem): boolean {
  return i.freshDays !== null && i.oldestDays !== null && i.oldestDays >= i.freshDays;
}

function stockText(i: KassaItem): string {
  if (!i.isTracked) return "";
  if (i.qty < 0) return `минус ${formatQty(-i.qty)}`;
  if (i.qty === 0) return "нет";
  return `ост. ${formatQty(i.qty)}`;
}

const STRIPE: Record<State, string> = {
  "": "",
  low: "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-amber-500",
  neg: "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-red-500",
};

/**
 * Плитка позиции: фото сверху — флорист находит эустому глазами, а не
 * читая названия. Нет фото — значок группы, чтобы плитка не пустовала.
 */
function ItemTile({ item, icon, onAdd }: { item: KassaItem; icon: string | null; onAdd: (i: KassaItem) => void }) {
  const st = stockState(item);
  return (
    <button
      type="button"
      onClick={() => onAdd(item)}
      className={`relative flex flex-col overflow-hidden rounded-xl bg-white text-left ring-1 ring-inset ring-zinc-200 transition hover:ring-lavender-300 active:scale-[0.98] ${STRIPE[st]}`}
    >
      <span className="relative block aspect-[4/3] bg-zinc-100">
        {item.photoUrl ? (
          <Image src={item.photoUrl} alt="" fill sizes="(min-width: 1024px) 160px, 33vw" className="object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-zinc-300">
            <GroupIcon icon={icon} className="h-9 w-9" />
          </span>
        )}
        {isOld(item) && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900" title="Лежит дольше срока свежести — в работу первой">
            {item.oldestDays} дн.
          </span>
        )}
      </span>
      <span className="flex flex-1 flex-col justify-between gap-1 px-2.5 py-2">
        <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-zinc-900">{item.title}</span>
        <span className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
          <span className="font-semibold text-zinc-900">{item.price ? formatMoney(item.price) : <span className="text-amber-700">без цены</span>}</span>
          <span className={st === "neg" ? "font-semibold text-red-600" : st === "low" ? "font-semibold text-amber-700" : "text-zinc-500"}>{stockText(item)}</span>
        </span>
      </span>
    </button>
  );
}

/** Частые — одной строкой: маленькое фото, название и цена. Остаток — только если с ним что-то не так. */
function FrequentChip({ item, icon, onAdd }: { item: KassaItem; icon: string | null; onAdd: (i: KassaItem) => void }) {
  const st = stockState(item);
  const tag = st === "neg" ? stockText(item) : st === "low" ? "мало" : isOld(item) ? `${item.oldestDays} дн.` : null;
  return (
    <button
      type="button"
      onClick={() => onAdd(item)}
      className={`relative flex h-11 items-center gap-2 overflow-hidden rounded-lg bg-white pl-1 pr-2.5 text-left text-[13px] ring-1 ring-inset ring-zinc-200 transition hover:ring-lavender-300 active:scale-[0.98] ${STRIPE[st]}`}
    >
      <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-zinc-100">
        {item.photoUrl ? (
          <Image src={item.photoUrl} alt="" fill sizes="36px" className="object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-zinc-300">
            <GroupIcon icon={icon} className="h-5 w-5" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">{item.title}</span>
      {tag && (
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${st === "neg" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{tag}</span>
      )}
      <span className="shrink-0 font-semibold tabular-nums text-zinc-900">{item.price ? formatMoney(item.price) : "—"}</span>
    </button>
  );
}

type Props = {
  assembly: boolean;
  items: KassaItem[];
  groups: KassaGroup[];
  frequent: string[];
  vitrine: VitrineBouquet[];
  query: string;
  onQuery: (q: string) => void;
  group: string | null;
  onGroup: (g: string | null) => void;
  onAdd: (i: KassaItem) => void;
  onOpenVitrine: () => void;
  /** Нет — продавать букет без состава запрещено в «Настройках», плитки нет. */
  onPriceBouquet?: () => void;
};

export function Assortment({ assembly, items, groups, frequent, vitrine, query, onQuery, group, onGroup, onAdd, onOpenVitrine, onPriceBouquet }: Props) {
  // В сборку на витрину кладут только то, что ведётся по складу и идёт в букет.
  const pool = assembly ? items.filter((i) => i.isTracked && !i.standalone) : items;
  const byId = new Map(pool.map((i) => [i.id, i]));
  const groupIcon = new Map(groups.map((g) => [g.id, g.icon]));
  const iconOf = (i: KassaItem) => (i.groupId ? groupIcon.get(i.groupId) ?? null : null);
  const q = query.trim().toLowerCase();

  const found = q ? pool.filter((i) => i.title.toLowerCase().includes(q)).slice(0, 60) : null;
  const inGroup = group ? pool.filter((i) => i.groupId === group) : null;
  const freq = frequent.map((id) => byId.get(id)).filter((i): i is KassaItem => !!i);

  const groupTiles = groups
    .map((g) => {
      const list = pool.filter((i) => i.groupId === g.id);
      return { ...g, count: list.length, negative: list.filter((i) => i.isTracked && i.qty < 0).length };
    })
    .filter((g) => g.count > 0);

  const oldVitrine = vitrine.filter((b) => b.days >= 2).length;
  const thumbs = [...vitrine].sort((a, b) => a.assembledAt.localeCompare(b.assembledAt)).slice(0, 3);

  return (
    <div className="flex min-h-0 flex-col">
      <input
        id="kassa-search"
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Поиск: название"
        aria-label="Поиск по ассортименту"
        className={`${ui.field} h-12`}
      />

      {found ? (
        <section className="mt-4">
          <h2 className={`${ui.label} mb-2`}>Найдено: {found.length}</h2>
          {found.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
              {found.map((i) => (
                <ItemTile key={i.id} item={i} icon={iconOf(i)} onAdd={onAdd} />
              ))}
            </div>
          ) : (
            <p className={ui.muted}>Ничего. Попробуйте часть слова.</p>
          )}
        </section>
      ) : inGroup ? (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className={ui.label}>{groups.find((g) => g.id === group)?.title}</h2>
            <button type="button" onClick={() => onGroup(null)} className="text-sm font-semibold text-lavender-700">
              ← все группы
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
            {inGroup.map((i) => (
              <ItemTile key={i.id} item={i} icon={iconOf(i)} onAdd={onAdd} />
            ))}
          </div>
        </section>
      ) : (
        <>
          {!assembly && (
            <div className="mt-3 grid gap-2 lg:grid-cols-[1.4fr_1fr]">
              <button
                type="button"
                onClick={onOpenVitrine}
                className="flex min-h-[72px] items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left ring-1 ring-inset ring-zinc-200 transition hover:ring-lavender-300"
              >
                <span className="flex shrink-0">
                  {thumbs.map((b, i) => (
                    <span key={b.id} className={`relative h-12 w-10 overflow-hidden rounded-lg bg-zinc-100 ring-2 ring-white ${i ? "-ml-3" : ""}`}>
                      {b.photoUrls[0] && <Image src={b.photoUrls[0]} alt="" fill sizes="40px" className="object-cover" />}
                    </span>
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-[15px] font-semibold text-zinc-900">Витрина · {vitrine.length}</span>
                  <span className="block text-xs text-zinc-500">
                    {oldVitrine > 0 && <span className="font-semibold text-red-600">{oldVitrine} на 3-й день · </span>}
                    продать в одно касание
                  </span>
                </span>
              </button>
              {onPriceBouquet && (
                <button
                  type="button"
                  onClick={onPriceBouquet}
                  className="flex min-h-[72px] items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left ring-1 ring-inset ring-zinc-200 transition hover:ring-lavender-300"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lavender-50 font-display text-xl font-bold text-lavender-700">₽</span>
                  <span className="min-w-0">
                    <span className="block font-display text-[15px] font-semibold text-zinc-900">Букет по цене</span>
                    <span className="block text-xs text-zinc-500">ввести сумму, состав — по желанию</span>
                  </span>
                </button>
              )}
            </div>
          )}

          {freq.length > 0 && (
            <section className="mt-5">
              <h2 className={`${ui.label} mb-2`}>Частые</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-1.5">
                {freq.map((i) => (
                  <FrequentChip key={i.id} item={i} icon={iconOf(i)} onAdd={onAdd} />
                ))}
              </div>
            </section>
          )}

          <section className="mt-5">
            <h2 className={`${ui.label} mb-2`}>Группы</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {groupTiles.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onGroup(g.id)}
                  className="flex min-h-[56px] items-center gap-2.5 rounded-xl bg-white px-3 py-2 text-left ring-1 ring-inset ring-zinc-200 transition hover:ring-lavender-300"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-lavender-50 text-lavender-700">
                    <GroupIcon icon={g.icon} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-zinc-900">{g.title}</span>
                    <span className="block whitespace-nowrap text-xs text-zinc-500">
                      {g.count} поз.{g.negative > 0 && <span className="font-semibold text-red-600"> · минус {g.negative}</span>}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
