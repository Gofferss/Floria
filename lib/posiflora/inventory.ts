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

// ================================================================
// Числовые остатки склада.
//
// Зачем понадобилось. getAllAvailableInventoryItemIds выше отвечает лишь
// на вопрос «позиция вообще есть?», без количества. Из-за этого букет из
// 101 розы показывался в наличии, когда на складе лежало 96 — цветы есть,
// но на этот букет их не хватает.
//
// Как достаём число. В атрибутах позиции склада баланса нет (проверено по
// их openapi), зато есть /inventory-items/{id}/warehouse-movement/{store}:
// список движений с полем qty. Текущий остаток — это СУММА всех qty.
//
// Почему сумма, а не поле remainderQty из последнего движения. У самых
// свежих записей remainderQty приходит пустым — это непроведённые
// документы. На реальных данных: последний непустой остаток 121 от
// 23 августа, после него непроведённая продажа на 25 штук, а склад
// показывает 96. Сумма qty даёт ровно 96, remainderQty — 121.
//
// Обязательные параметры filter[startDate] и filter[endDate] в их openapi
// не описаны — эндпоинт молча отвечает 422 «This value should not be
// blank», и только в поле source.parameter видно, чего он хочет. Формы
// startDate=, start_date= и filter в теле не работают, принимается именно
// filter[startDate].
// ================================================================

const MOVEMENT_PAGE_SIZE = 200;
const MOVEMENT_MAX_PAGES = 20;

/** Дата, заведомо более ранняя, чем первое движение по любому складу. */
const MOVEMENTS_SINCE = "2000-01-01";

type MovementResource = {
  attributes?: {
    qty?: number | string | null;
  };
};

type StoreResource = { id: string };

async function fetchStoreIds(): Promise<string[]> {
  const json = (await posifloraFetch("/stores")) as PosifloraListResponse<StoreResource>;
  return (json.data ?? []).map((s) => s.id);
}

/** Сумма движений одной позиции по одному складу. */
async function sumMovements(itemId: string, storeId: string): Promise<number> {
  // Верхняя граница — «сегодня плюс запас»: у документов будущей датой
  // (предзаказы) движение уже числится, и отсекать его нельзя.
  const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let total = 0;
  for (let page = 1; page <= MOVEMENT_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      "filter[startDate]": MOVEMENTS_SINCE,
      "filter[endDate]": endDate,
      "page[number]": String(page),
      "page[size]": String(MOVEMENT_PAGE_SIZE),
    });

    const json = (await posifloraFetch(
      `/inventory-items/${itemId}/warehouse-movement/${storeId}?${params.toString()}`
    )) as PosifloraListResponse<MovementResource>;

    const rows = json.data ?? [];
    for (const row of rows) total += Number(row.attributes?.qty ?? 0) || 0;
    if (rows.length < MOVEMENT_PAGE_SIZE) break;
  }

  return total;
}

/**
 * Текущие остатки по списку позиций склада, суммарно по всем складам.
 *
 * Запросов получается «позиций × складов», поэтому вызывать это стоит
 * только для ингредиентов, реально участвующих в рецептах, — их единицы.
 * Позиция, по которой не удалось получить движения, в результат не
 * попадает: вызывающий код трактует отсутствие как «неизвестно» и не
 * делает вид, что остаток нулевой.
 */
export async function getInventoryBalances(itemIds: string[]): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  if (itemIds.length === 0) return balances;

  const storeIds = await fetchStoreIds();
  if (storeIds.length === 0) return balances;

  for (const itemId of itemIds) {
    let total = 0;
    let ok = false;
    for (const storeId of storeIds) {
      try {
        total += await sumMovements(itemId, storeId);
        ok = true;
      } catch (error) {
        console.error(`[getInventoryBalances] ${itemId} / ${storeId}:`, error);
      }
    }
    if (ok) balances.set(itemId, total);
  }

  return balances;
}
