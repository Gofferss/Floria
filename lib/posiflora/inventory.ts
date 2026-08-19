import { posifloraFetch } from "./http";

// ================================================================
// Складские позиции Posiflora (сырьё — конкретные цветы/материалы),
// отдельно от "товаров" (готовых букетов на витрине, см. catalog.ts).
// Используется рецептами букетов (product_recipe_items) — админка
// ищет здесь реальные позиции склада, чтобы рецепт ссылался на
// настоящий id, а не на текст.
// ================================================================

type PosifloraInventoryItemResource = {
  id: string;
  attributes?: {
    title?: string;
  };
};

type PosifloraListResponse<T> = {
  data?: T[];
};

export type InventoryItemOption = {
  id: string;
  title: string;
};

/**
 * Поиск позиций склада по названию — для автокомплита в форме рецепта.
 * Без фильтра public/onWindow (в отличие от fetchAllInventoryItems в
 * catalog.ts) — рецепту нужно сырьё (отдельные цветы), а не то, что
 * само по себе продаётся как товар на витрине.
 */
export async function searchInventoryItems(query: string): Promise<InventoryItemOption[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({ search: trimmed, "page[size]": "20" });
  const json = (await posifloraFetch(`/inventory-items?${params.toString()}`)) as PosifloraListResponse<PosifloraInventoryItemResource>;

  return (json.data ?? [])
    .filter((item) => item.attributes?.title?.trim())
    .map((item) => ({ id: item.id, title: item.attributes!.title!.trim() }));
}

const MAX_AVAILABLE_PAGES = 50;
const AVAILABLE_PAGE_SIZE = 100;

/**
 * Полный набор id позиций склада, которые сейчас в наличии (остаток > 0,
 * по ЛЮБОМУ количеству — не "хватает ровно на рецепт", см. ниже).
 *
 * ВАЖНО: filter[id][] на этом эндпоинте на практике НЕ фильтрует —
 * проверено на реальном аккаунте: запрос с ?filter[id][]=X дал точно
 * тот же список и тот же total, что и без него вовсе (ни одного из
 * трёх переданных id в ответе не оказалось, хотя все три существуют
 * при прямом GET /inventory-items/{id}). Судя по всему, Posiflora
 * такое сочетание фильтров просто игнорирует, вопреки описанию в их
 * openapi. Поэтому вместо "спросить по конкретным id" — вытягиваем
 * ВЕСЬ список filter[available]=true целиком (на реальном аккаунте
 * это ~193 позиции, 2 страницы по 100 — быстро и дёшево) и дальше
 * сверяем id рецептов с ним уже на своей стороне.
 *
 * Остаток > 0 — а не "хватает ровно на N штук по рецепту": Posiflora
 * не даёт в этом же ответе числовое поле баланса, только сам факт
 * filter[available]. Для небольшой цветочной обычно этого достаточно:
 * если розы вообще есть на складе, найдётся и на один букет. Точный
 * подсчёт штук можно добавить позже отдельным эндпоинтом
 * (warehouse-movement), если бинарной проверки окажется мало.
 */
export async function getAllAvailableInventoryItemIds(): Promise<Set<string>> {
  const available = new Set<string>();

  for (let page = 1; page <= MAX_AVAILABLE_PAGES; page++) {
    const params = new URLSearchParams({
      "filter[available]": "true",
      "page[number]": String(page),
      "page[size]": String(AVAILABLE_PAGE_SIZE),
    });
    const json = (await posifloraFetch(`/inventory-items?${params.toString()}`)) as PosifloraListResponse<PosifloraInventoryItemResource>;
    const items = json.data ?? [];
    for (const item of items) available.add(item.id);
    if (items.length < AVAILABLE_PAGE_SIZE) break; // последняя страница
  }

  return available;
}
