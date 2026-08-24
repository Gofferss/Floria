import { getSupabaseAdmin } from "@/lib/supabase";
import { posifloraFetch } from "./http";
import { generateProductSlug } from "./slug";
import { getInventoryBalances } from "./inventory";

// ================================================================
// Синхронизация каталога (категории + товары) из Posiflora в наш кэш
// (product_categories, products). Источник для товаров — Inventory
// Items API с фильтром public+onWindow: это то, что реально стоит на
// витрине, а не весь внутренний инвентарь (услуги, черновики и т.п.).
//
// v1 — полный синк на каждый запуск, без инкрементального `from`.
// Для магазина на десятки-сотни позиций это несколько лёгких запросов
// раз в 15-30 минут — усложнять раньше времени смысла нет. Если каталог
// вырастет на порядок, можно добавить `from` = время последнего
// успешного синка (сама Posiflora такой фильтр документирует).
// ================================================================

// ---------------------------------------------------------------
// Типы ответов Posiflora (только то, что реально используем)
// ---------------------------------------------------------------

type PosifloraCategoryResource = {
  id: string;
  attributes?: {
    title?: string;
    status?: "on" | "off";
    deleted?: boolean;
  };
};

type PosifloraInventoryItemResource = {
  id: string;
  attributes?: {
    title?: string;
    description?: string | null;
    priceMin?: number;
    priceMax?: number;
    public?: boolean;
  };
  relationships?: {
    category?: { data?: { id: string } | null };
  };
};

type PosifloraListResponse<T> = {
  data?: T[];
  meta?: { page?: { number?: number; size?: number | null }; total?: number };
};

// Защита от бесконечного цикла, если параметры пагинации у Posiflora
// когда-нибудь окажутся не теми, что мы предполагаем (см. комментарий
// у fetchAllInventoryItems ниже) — реальный каталог такого числа
// страниц не наберёт.
const MAX_PAGES = 200;
const PAGE_SIZE = 100;

// ---------------------------------------------------------------
// Категории
// ---------------------------------------------------------------

async function fetchPosifloraCategories(): Promise<PosifloraCategoryResource[]> {
  const json = (await posifloraFetch("/categories")) as PosifloraListResponse<PosifloraCategoryResource>;
  return json.data ?? [];
}

/**
 * Синк категорий — намеренно ПЛОСКИЙ, без вложенности (parent/child из
 * Posiflora игнорируется). Наш фронтенд нигде не отображает вложенные
 * категории — синхронизировать иерархию, которую никто не показывает,
 * было бы усложнением ради усложнения. Если появится реальная
 * потребность в подкатегориях на сайте — это отдельный проход с
 * двухфазным upsert (сперва все строки, потом резолв parent_id).
 */
async function syncCategories(): Promise<Map<string, string>> {
  const supabaseAdmin = getSupabaseAdmin();
  const categories = await fetchPosifloraCategories();

  const posifloraIdToOurId = new Map<string, string>();

  for (const category of categories) {
    const title = category.attributes?.title?.trim();
    if (!title) continue;

    const isActive = category.attributes?.status === "on" && !category.attributes?.deleted;

    const { data: existing } = await supabaseAdmin
      .from("product_categories")
      .select("id, slug")
      .eq("posiflora_category_id", category.id)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("product_categories")
        .update({ name: title, is_active: isActive })
        .eq("id", existing.id);
      posifloraIdToOurId.set(category.id, existing.id);
      continue;
    }

    const slug = generateProductSlug(title, category.id);
    const { data: created, error } = await supabaseAdmin
      .from("product_categories")
      .insert({
        posiflora_category_id: category.id,
        name: title,
        slug,
        is_active: isActive,
      })
      .select("id")
      .single();

    if (error || !created) {
      console.error(`Не удалось создать категорию "${title}" (${category.id}):`, error);
      continue;
    }

    posifloraIdToOurId.set(category.id, created.id);
  }

  return posifloraIdToOurId;
}

// ---------------------------------------------------------------
// Товары
// ---------------------------------------------------------------

/**
 * ВАЖНАЯ ОГОВОРКА про пагинацию: документация Posiflora показывает
 * форму ответа (meta.page.number/size), но не форму ЗАПРОСА явно для
 * этого эндпоинта. По аналогии с остальными bracket-style фильтрами
 * API (filter[...]) предполагаю page[number]/page[size] — это
 * стандарт JSON:API, которому в целом следует их API (Content-Type:
 * application/vnd.api+json). Цикл защищён MAX_PAGES и остановкой по
 * пустой странице — если названия параметров окажутся не теми, синк
 * в худшем случае просто обработает первую страницу и на этом
 * остановится, а не зациклится. Стоит свериться на реальном аккаунте.
 */
async function fetchAllInventoryItems(): Promise<PosifloraInventoryItemResource[]> {
  const items: PosifloraInventoryItemResource[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({
      "filter[available]": "true",
      public: "true",
      onWindow: "true",
      "page[number]": String(page),
      "page[size]": String(PAGE_SIZE),
    });

    const json = (await posifloraFetch(
      `/inventory-items?${query.toString()}`
    )) as PosifloraListResponse<PosifloraInventoryItemResource>;

    const pageItems = json.data ?? [];
    items.push(...pageItems);

    if (pageItems.length < PAGE_SIZE) break; // последняя страница
  }

  return items;
}

function toPrice(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export type CatalogSyncSummary = {
  categoriesProcessed: number;
  productsCreated: number;
  productsUpdated: number;
  productsDeactivated: number;
  recipeProductsChecked: number;
  errors: string[];
};

/**
 * Автоналичие по составу — товары с availability_source='recipe' (см.
 * migrations/010_recipe_availability.sql). Для каждого такого товара:
 * все ингредиенты рецепта есть на складе (хоть в каком-то количестве,
 * см. оговорку в lib/posiflora/inventory.ts) → 'in_stock', иначе
 * 'made_to_order'. Товары с availability_source='manual' (по умолчанию
 * все) здесь не трогаем вообще — ручной режим приоритетнее автоматики.
 *
 * Один общий запрос остатков на ВСЕ уникальные ингредиенты сразу
 * (а не по одному на товар) — при пересекающихся рецептах (одна и та
 * же роза в десятке букетов) кратно меньше обращений к Posiflora.
 */
async function syncComputedAvailability(errors: string[]): Promise<number> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: recipeProducts, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("availability_source", "recipe");

  if (productsError) {
    errors.push(`Автоналичие: не удалось получить список товаров: ${productsError.message}`);
    return 0;
  }
  if (!recipeProducts || recipeProducts.length === 0) return 0;

  const productIds = recipeProducts.map((p) => p.id);
  const { data: recipeItems, error: itemsError } = await supabaseAdmin
    .from("product_recipe_items")
    .select("product_id, posiflora_inventory_item_id, quantity")
    .in("product_id", productIds);

  if (itemsError) {
    errors.push(`Автоналичие: не удалось получить рецепты: ${itemsError.message}`);
    return 0;
  }

  const itemsByProduct = new Map<string, { id: string; needed: number }[]>();
  for (const row of recipeItems ?? []) {
    const list = itemsByProduct.get(row.product_id) ?? [];
    list.push({
      id: row.posiflora_inventory_item_id,
      needed: Math.max(Number(row.quantity) || 0, 0),
    });
    itemsByProduct.set(row.product_id, list);
  }

  // Числовые остатки, а не «позиция есть / позиции нет». Раньше сверялся
  // только сам факт наличия, из-за чего букет из 101 розы показывался в
  // наличии при 96 штуках на складе: розы есть, но на этот букет их не
  // хватает. Спрашиваем остатки один раз на все уникальные ингредиенты —
  // одна и та же роза встречается в десятке рецептов.
  const uniqueIngredientIds = [
    ...new Set((recipeItems ?? []).map((row) => row.posiflora_inventory_item_id as string)),
  ];
  const balances = await getInventoryBalances(uniqueIngredientIds);

  let checked = 0;
  for (const productId of productIds) {
    const ingredientIds = itemsByProduct.get(productId);
    // Товар помечен "по рецепту", но рецепт ещё не заполнен — не
    // затираем последний осознанный статус пустым результатом.
    if (!ingredientIds || ingredientIds.length === 0) continue;

    // Остаток неизвестен (склад не ответил по этой позиции) — считаем,
    // что хватает: молча увести букет «под заказ» из-за сбоя связи хуже,
    // чем показать его доступным лишний раз. Заведомая нехватка — только
    // когда остаток известен и меньше нужного.
    const inStock = ingredientIds.every(({ id, needed }) => {
      const balance = balances.get(id);
      if (balance === undefined) return true;
      return balance >= needed;
    });
    const { error } = await supabaseAdmin
      .from("products")
      .update({ availability_mode: inStock ? "in_stock" : "made_to_order" })
      .eq("id", productId);

    if (error) {
      errors.push(`Автоналичие (${productId}): ${error.message}`);
    } else {
      checked++;
    }
  }

  return checked;
}

export async function syncPosifloraCatalog(): Promise<CatalogSyncSummary> {
  const supabaseAdmin = getSupabaseAdmin();
  const summary: CatalogSyncSummary = {
    categoriesProcessed: 0,
    productsCreated: 0,
    productsUpdated: 0,
    productsDeactivated: 0,
    recipeProductsChecked: 0,
    errors: [],
  };

  // Категории/товары и проверка наличия по рецепту читают Posiflora
  // независимо друг от друга — сбой одного не должен блокировать другой
  // (см. syncComputedAvailability ниже, вызывается уже вне этого try).
  // Наблюдали живьём: /categories иногда отвечает 500 сам по себе, пока
  // /inventory-items работает нормально — без этой изоляции такой сбой
  // остановил бы вообще весь синк, включая проверку остатков.
  try {
    const categoryIdMap = await syncCategories();
    summary.categoriesProcessed = categoryIdMap.size;

    const items = await fetchAllInventoryItems();
    const seenPosifloraIds = new Set<string>();

    for (const item of items) {
      const title = item.attributes?.title?.trim();
      if (!title) continue;

      seenPosifloraIds.add(item.id);

      const price = toPrice(item.attributes?.priceMin);
      const description = item.attributes?.description ?? null;
      const posifloraCategoryId = item.relationships?.category?.data?.id;
      const categoryId = posifloraCategoryId ? categoryIdMap.get(posifloraCategoryId) ?? null : null;

      const { data: existing } = await supabaseAdmin
        .from("products")
        .select("id")
        .eq("posiflora_product_id", item.id)
        .maybeSingle();

      if (existing) {
        // Обновляем ТОЛЬКО поля, которыми владеет Posiflora. attributes
        // (наши sizes/composition) здесь сознательно не
        // упоминаются — это территория флориста/менеджера, синк её не
        // трогает.
        const { error } = await supabaseAdmin
          .from("products")
          .update({
            name: title,
            description,
            price,
            category_id: categoryId,
            is_available: true,
            synced_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (error) {
          summary.errors.push(`Обновление "${title}" (${item.id}): ${error.message}`);
        } else {
          summary.productsUpdated++;
        }
        continue;
      }

      // Новый товар — минимальный каркас attributes, is_active: false.
      // Карточка не должна появиться на витрине раньше, чем куратор
      // впишет размеры/повод/состав.
      const slug = generateProductSlug(title, item.id);
      const { error } = await supabaseAdmin.from("products").insert({
        posiflora_product_id: item.id,
        category_id: categoryId,
        name: title,
        slug,
        description,
        price,
        stock_quantity: 0,
        is_available: true,
        is_active: false,
        attributes: {
          sizes: [{ id: "std", label: "Стандарт", priceModifier: 0 }],
          composition: [],
        },
        synced_at: new Date().toISOString(),
      });

      if (error) {
        summary.errors.push(`Создание "${title}" (${item.id}): ${error.message}`);
      } else {
        summary.productsCreated++;
      }
    }

    // Товары, которые раньше были реально синхронизированы (не
    // seed:*-заглушки и не admin:*-товары, добавленные вручную в
    // /admin/catalog — у них нет соответствия в Posiflora по определению),
    // но пропали из свежей выборки public+onWindow — мягко скрываем,
    // не удаляем: на них может ссылаться order_items.
    const { data: previouslySynced } = await supabaseAdmin
      .from("products")
      .select("id, posiflora_product_id")
      .eq("is_active", true)
      .not("posiflora_product_id", "like", "seed:%")
      .not("posiflora_product_id", "like", "admin:%");

    const toDeactivate = (previouslySynced ?? [])
      .filter((p) => !seenPosifloraIds.has(p.posiflora_product_id))
      .map((p) => p.id);

    if (toDeactivate.length > 0) {
      const { error } = await supabaseAdmin
        .from("products")
        .update({ is_active: false })
        .in("id", toDeactivate);

      if (error) {
        summary.errors.push(`Деактивация пропавших товаров: ${error.message}`);
      } else {
        summary.productsDeactivated = toDeactivate.length;
      }
    }
  } catch (error) {
    summary.errors.push(
      `Синхронизация категорий/товаров полностью упала: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  summary.recipeProductsChecked = await syncComputedAvailability(summary.errors);

  return summary;
}

/**
 * Пересчёт наличия ОДНОГО товара — сразу после сохранения в админке.
 *
 * Зачем отдельно от syncComputedAvailability. Тот пересчитывает всё разом
 * и живёт внутри полной синхронизации каталога, которую запускают редко.
 * Из-за этого получалось странное: куратор указывает в составе 101 розу
 * при 97 на складе, сохраняет — а товар как висел «в наличии», так и
 * висит, потому что пересчёт произойдёт неизвестно когда. Теперь статус
 * обновляется в тот же момент, что и сам рецепт.
 *
 * Ошибки намеренно не пробрасываются наверх: товар уже сохранён, и ронять
 * из-за недоступного склада всю операцию нельзя. В худшем случае статус
 * останется прежним до следующей полной синхронизации.
 */
export async function recomputeProductAvailability(productId: string): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: product } = await supabaseAdmin
    .from("products")
    .select("availability_source")
    .eq("id", productId)
    .maybeSingle();

  // Наличие ведут вручную — трогать его нельзя, это осознанный выбор куратора.
  if (!product || product.availability_source !== "recipe") return;

  const { data: recipeItems } = await supabaseAdmin
    .from("product_recipe_items")
    .select("posiflora_inventory_item_id, quantity")
    .eq("product_id", productId);

  // Состав ещё не заполнен — не затираем последний осознанный статус.
  if (!recipeItems || recipeItems.length === 0) return;

  try {
    const balances = await getInventoryBalances(
      recipeItems.map((row) => row.posiflora_inventory_item_id as string)
    );

    const inStock = recipeItems.every((row) => {
      const balance = balances.get(row.posiflora_inventory_item_id as string);
      if (balance === undefined) return true; // остаток неизвестен — не паникуем
      return balance >= (Number(row.quantity) || 0);
    });

    await supabaseAdmin
      .from("products")
      .update({ availability_mode: inStock ? "in_stock" : "made_to_order" })
      .eq("id", productId);
  } catch (error) {
    console.error(`[recomputeProductAvailability] ${productId}:`, error);
  }
}
