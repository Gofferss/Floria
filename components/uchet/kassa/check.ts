// ================================================================
// Чек кассы — данные и арифметика без интерфейса.
//
// В чеке три вида строк, как в базе (pos_record_sale):
//   * букет — собран здесь же: состав по позициям, цена по составу или
//     своя; без состава — «букет по цене»;
//   * витрина — готовый букет, цветы которого списаны ещё при сборке;
//   * позиция — игрушка, шар, открытка, услуга: отдельной строкой.
// ================================================================

import type { KassaItem, VitrineBouquet } from "@/lib/uchet/pos-queries";
import type { SaleInput } from "@/lib/uchet/pos-actions";

/**
 * Стебель в букете. price — своя цена за штуку только в этом чеке
 * (уступили: 110 вместо 120); на складе цена не меняется. Нет — по прайсу.
 */
export type Stem = { itemId: string; qty: number; price?: number | null };

export type BouquetLine = {
  key: string;
  title: string;
  /** Цена вручную; null — по составу. */
  manualPrice: number | null;
  stems: Stem[];
  /** Собран по рецепту — название рецепта предлагается и для витрины. */
  recipeId?: string;
};

export type VitrineLine = { key: string; bouquetId: string; title: string; price: number; photo: string | null };

export type ItemLine = { itemId: string; qty: number; price: number };

export type Customer = { id: string; name: string | null; phone: string; bonusBalance: number };

export type Check = {
  /** Идентификатор будущей продажи: повторная отправка не задвоит чек. */
  id: string;
  bouquets: BouquetLine[];
  vitrine: VitrineLine[];
  items: ItemLine[];
  customer: Customer | null;
  discountPercent: number;
  /** Допуск на скидку сверх лимита (подписан сервером). */
  approval: string | null;
  approvedBy: string | null;
  createdAt: number;
};

export function newCheck(): Check {
  return {
    id: crypto.randomUUID(),
    bouquets: [],
    vitrine: [],
    items: [],
    customer: null,
    discountPercent: 0,
    approval: null,
    approvedBy: null,
    createdAt: Date.now(),
  };
}

export function isEmpty(c: Check): boolean {
  return c.bouquets.length === 0 && c.vitrine.length === 0 && c.items.length === 0;
}

export type ItemIndex = Map<string, KassaItem>;

/** Цена стебля в этом чеке: своя, если поставили, иначе по прайсу. */
export function stemPrice(st: Stem, index: ItemIndex): number | null {
  return st.price ?? index.get(st.itemId)?.price ?? null;
}

/** Цена букета по составу — сумма цен стеблей. Позиции без цены дают 0. */
export function compositionPrice(b: BouquetLine, index: ItemIndex): number {
  return b.stems.reduce((s, st) => s + (stemPrice(st, index) ?? 0) * st.qty, 0);
}

export function bouquetPrice(b: BouquetLine, index: ItemIndex): number {
  return b.manualPrice ?? compositionPrice(b, index);
}

/** Позиции состава без цены — чтобы предупредить, что цена по составу занижена. */
export function unpricedStems(b: BouquetLine, index: ItemIndex): number {
  return b.stems.filter((s) => !stemPrice(s, index)).length;
}

/** Что отложено этим чеком: стебли букетов и позиции, по штукам. */
export function heldItems(c: Check): { itemId: string; qty: number }[] {
  const sum = new Map<string, number>();
  for (const b of c.bouquets) for (const s of b.stems) sum.set(s.itemId, (sum.get(s.itemId) ?? 0) + s.qty);
  for (const i of c.items) sum.set(i.itemId, (sum.get(i.itemId) ?? 0) + i.qty);
  return [...sum.entries()].filter(([, qty]) => qty > 0).map(([itemId, qty]) => ({ itemId, qty }));
}

/** Короткое название чека для чужого айпада: «Букет 1 и ещё 2». */
export function checkTitle(c: Check): string {
  const parts = [...c.vitrine.map((v) => v.title), ...c.bouquets.map((b) => b.title), ...(c.items.length ? ["позиции"] : [])];
  if (parts.length === 0) return "Чек";
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.length > 1 ? `${first} и ещё ${parts.length - 1}` : first;
}

export function subtotal(c: Check, index: ItemIndex): number {
  return (
    c.bouquets.reduce((s, b) => s + bouquetPrice(b, index), 0) +
    c.vitrine.reduce((s, v) => s + v.price, 0) +
    c.items.reduce((s, i) => s + i.price * i.qty, 0)
  );
}

/** Скидка в рублях — округляется до рубля так же, как в базе. */
export function discountAmount(c: Check, index: ItemIndex): number {
  return Math.round((subtotal(c, index) * c.discountPercent) / 100);
}

export function due(c: Check, index: ItemIndex): number {
  return Math.max(0, Math.round((subtotal(c, index) - discountAmount(c, index)) * 100) / 100);
}

export function lineCount(c: Check): number {
  return c.bouquets.length + c.vitrine.length + c.items.reduce((s, i) => s + i.qty, 0);
}

export function toSaleInput(c: Check, index: ItemIndex, payments: { method: string; amount: number }[]): SaleInput {
  return {
    id: c.id,
    customerId: c.customer?.id ?? null,
    discountPercent: c.discountPercent,
    approval: c.approval,
    comment: null,
    lines: [
      ...c.vitrine.map((v) => ({ kind: "vitrine" as const, bouquetId: v.bouquetId })),
      ...c.bouquets.map((b) => ({
        kind: "bouquet" as const,
        id: b.key,
        title: b.title,
        price: bouquetPrice(b, index),
        items: b.stems.filter((s) => s.qty > 0).map((s) => ({ itemId: s.itemId, qty: s.qty })),
      })),
      ...c.items.map((i) => ({ kind: "item" as const, itemId: i.itemId, qty: i.qty, price: i.price })),
    ],
    payments,
  };
}

export function vitrineLine(b: VitrineBouquet): VitrineLine {
  return { key: crypto.randomUUID(), bouquetId: b.id, title: b.title, price: b.price, photo: b.photoUrls[0] ?? null };
}

// ---------------------------------------------------------------
// Чек не теряется: всё набранное лежит на планшете, пока не оплачено.
// ---------------------------------------------------------------

const STORE = "uchet.kassa.v1";

export type Saved = { current: Check; parked: Check[] };

export function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Saved;
    if (!parsed?.current?.id) return null;
    // Чек старше суток — скорее забытый, чем отложенный.
    const fresh = (c: Check) => Date.now() - (c.createdAt ?? 0) < 24 * 60 * 60 * 1000;
    return { current: fresh(parsed.current) ? parsed.current : newCheck(), parked: (parsed.parked ?? []).filter(fresh) };
  } catch {
    return null;
  }
}

export function save(s: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // Хранилище недоступно (частный режим) — чек живёт до перезагрузки.
  }
}
