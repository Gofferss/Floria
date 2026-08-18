import { supabase } from "@/lib/supabase";

// ================================================================
// Каталог товаров: выборка из Supabase (таблицы products и
// product_categories, см. migrations/003_seed_products.sql).
//
// Читаем анонимным ключом — RLS-политика public_read_active_products
// разрешает SELECT только активных записей. Запись в каталог идёт
// исключительно через service-role клиент (синхронизация с Posiflora).
//
// ВАЖНО: все функции стали АСИНХРОННЫМИ. Вызывать их можно только из
// серверных компонентов / route handlers (`await getProducts()`),
// но не из компонентов с "use client" — те получают товары пропсами.
// ================================================================

// Раньше был фиксированный список (OCCASIONS), теперь поводы редактируются
// в /admin/occasions (см. lib/occasions.ts, таблица occasions) — здесь
// остаётся просто строка, сверка со списком активных поводов происходит
// там, где он используется (форма товара, фильтр каталога), а не при чтении.
export type Occasion = string;

export type ProductSize = {
  id: string;
  label: string;
  priceModifier: number;
};

export const AVAILABILITY_MODES = ["in_stock", "made_to_order"] as const;
export type AvailabilityMode = (typeof AVAILABILITY_MODES)[number];

export const AVAILABILITY_MODE_LABELS: Record<AvailabilityMode, string> = {
  in_stock: "В наличии",
  made_to_order: "Под заказ",
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  occasions: Occasion[];
  basePrice: number;
  oldPrice?: number;
  composition: string[];
  description: string;
  sizes: ProductSize[];
  images: string[];
  availabilityMode: AvailabilityMode;
};

/** Запасной размер для товаров, у которых в attributes нет ни одного */
const FALLBACK_SIZE: ProductSize = { id: "std", label: "Стандарт", priceModifier: 0 };

/** Поля, которые тянем из БД. Джойним категорию ради её slug. */
const PRODUCT_SELECT = `
  id,
  slug,
  name,
  description,
  price,
  old_price,
  attributes,
  images,
  availability_mode,
  product_categories ( slug )
`;

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number | string;
  old_price: number | string | null;
  attributes: unknown;
  images: unknown;
  availability_mode: string | null;
  // supabase-js типизирует вложенный джойн как объект или массив в
  // зависимости от кардинальности — обрабатываем оба варианта
  product_categories: { slug: string } | { slug: string }[] | null;
};

// ---------------------------------------------------------------
// Маппинг строки БД → доменная модель Product
// ---------------------------------------------------------------

function toNumber(value: number | string | null): number {
  // PostgREST может отдавать numeric строкой — приводим явно
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed as number) ? (parsed as number) : 0;
}

function parseSizes(attributes: Record<string, unknown>): ProductSize[] {
  const raw = attributes.sizes;
  if (!Array.isArray(raw)) return [FALLBACK_SIZE];

  const sizes = raw
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({
      id: String(s.id ?? ""),
      label: String(s.label ?? ""),
      priceModifier: toNumber((s.priceModifier as number | string) ?? 0),
    }))
    .filter((s) => s.id && s.label);

  return sizes.length > 0 ? sizes : [FALLBACK_SIZE];
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function parseOccasions(attributes: Record<string, unknown>): Occasion[] {
  return parseStringArray(attributes.occasions);
}

function parseAvailabilityMode(value: string | null): AvailabilityMode {
  return value === "made_to_order" ? "made_to_order" : "in_stock";
}

function mapRow(row: ProductRow): Product {
  const attributes =
    typeof row.attributes === "object" && row.attributes !== null
      ? (row.attributes as Record<string, unknown>)
      : {};

  const category = Array.isArray(row.product_categories)
    ? row.product_categories[0]
    : row.product_categories;

  const oldPrice = row.old_price === null ? undefined : toNumber(row.old_price);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    categorySlug: category?.slug ?? "",
    occasions: parseOccasions(attributes),
    basePrice: toNumber(row.price),
    oldPrice,
    composition: parseStringArray(attributes.composition),
    description: row.description ?? "",
    sizes: parseSizes(attributes),
    images: parseStringArray(row.images),
    availabilityMode: parseAvailabilityMode(row.availability_mode),
  };
}

/**
 * Ошибки запроса логируем и возвращаем пустой результат, а не бросаем
 * исключение: недоступность БД не должна ронять всю страницу — каталог
 * покажет пустое состояние, которое уже предусмотрено в CatalogView.
 */
function handleError(context: string, error: { message: string } | null): boolean {
  if (!error) return false;
  console.error(`[products] ${context}:`, error.message);
  return true;
}

// ---------------------------------------------------------------
// Публичное API
// ---------------------------------------------------------------

/** Все активные товары каталога */
export async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (handleError("getProducts", error) || !data) return [];
  return (data as unknown as ProductRow[]).map(mapRow);
}

/**
 * Только слаги активных товаров — для generateStaticParams.
 * Отдельный запрос вместо getProducts(), чтобы не тянуть из БД
 * описания и attributes ради одного поля.
 */
export async function getProductSlugs(): Promise<string[]> {
  const { data, error } = await supabase
    .from("products")
    .select("slug")
    .eq("is_active", true);

  if (handleError("getProductSlugs", error) || !data) return [];
  return data.map((row) => row.slug as string);
}

/** Один товар по слагу. null, если не найден или снят с публикации. */
export async function getProductBySlug(slug: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (handleError(`getProductBySlug(${slug})`, error) || !data) return null;
  return mapRow(data as unknown as ProductRow);
}

/** Товары одной категории (по слагу категории) */
export async function getProductsByCategory(categorySlug: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .eq("product_categories.slug", categorySlug)
    .not("product_categories", "is", null)
    .order("created_at", { ascending: true });

  if (handleError(`getProductsByCategory(${categorySlug})`, error) || !data) return [];
  return (data as unknown as ProductRow[]).map(mapRow);
}

/** Похожие товары — из той же категории, исключая текущий */
export async function getRelatedProducts(product: Product, limit = 3): Promise<Product[]> {
  if (!product.categorySlug) return [];

  const sameCategory = await getProductsByCategory(product.categorySlug);
  return sameCategory.filter((p) => p.id !== product.id).slice(0, limit);
}

/**
 * Выборка по списку слагов с сохранением порядка, заданного в списке
 * (а не порядка в БД) — используется для кросс-сейла в статьях блога.
 * Отсутствующие слаги молча отбрасываются.
 */
export async function getProductsBySlugs(slugs: string[]): Promise<Product[]> {
  if (slugs.length === 0) return [];

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .in("slug", slugs)
    .eq("is_active", true);

  if (handleError("getProductsBySlugs", error) || !data) return [];

  const bySlug = new Map(
    (data as unknown as ProductRow[]).map((row) => [row.slug, mapRow(row)])
  );
  return slugs
    .map((slug) => bySlug.get(slug))
    .filter((p): p is Product => p !== undefined);
}

/** Минимальная и максимальная цена в каталоге — для плейсхолдеров фильтра */
export async function getPriceBounds(): Promise<{ min: number; max: number }> {
  const [minResult, maxResult] = await Promise.all([
    supabase
      .from("products")
      .select("price")
      .eq("is_active", true)
      .order("price", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("products")
      .select("price")
      .eq("is_active", true)
      .order("price", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (handleError("getPriceBounds(min)", minResult.error)) return { min: 0, max: 0 };
  if (handleError("getPriceBounds(max)", maxResult.error)) return { min: 0, max: 0 };

  return {
    min: minResult.data ? toNumber(minResult.data.price) : 0,
    max: maxResult.data ? toNumber(maxResult.data.price) : 0,
  };
}
