import { getSupabaseAdmin } from "@/lib/supabase";
import { posifloraFetch } from "./http";
import { generateProductSlug } from "./slug";

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
  errors: string[];
};

export async function syncPosifloraCatalog(): Promise<CatalogSyncSummary> {
  const supabaseAdmin = getSupabaseAdmin();
  const summary: CatalogSyncSummary = {
    categoriesProcessed: 0,
    productsCreated: 0,
    productsUpdated: 0,
    productsDeactivated: 0,
    errors: [],
  };

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
      // (наши sizes/occasions/composition) здесь сознательно не
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
        occasions: [],
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
  // seed:*-заглушки), но пропали из свежей выборки public+onWindow —
  // мягко скрываем, не удаляем: на них может ссылаться order_items.
  const { data: previouslySynced } = await supabaseAdmin
    .from("products")
    .select("id, posiflora_product_id")
    .eq("is_active", true)
    .not("posiflora_product_id", "like", "seed:%");

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

  return summary;
}
