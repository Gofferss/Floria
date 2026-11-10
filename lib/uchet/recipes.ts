import { getSupabaseAdmin } from "@/lib/supabase";
import type { RecipeLine } from "@/lib/uchet/recipe-price";

// ================================================================
// Рецепты букетов (039): чтение для кассы и страницы «Рецепты».
// ================================================================

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** То, что нужно кассе: положить букет в чек или собрать на витрину. */
export type KassaRecipe = {
  id: string;
  title: string;
  nickname: string | null;
  photoUrl: string | null;
  priceMode: "composition" | "fixed";
  fixedPrice: number | null;
  items: RecipeLine[];
};

export type RecipeProduct = { id: string; name: string; nickname: string | null; slug: string; price: number; image: string | null; isActive: boolean };

export type Recipe = KassaRecipe & {
  isActive: boolean;
  sort: number;
  productId: string | null;
  product: RecipeProduct | null;
  posifloraSpecId: string | null;
  posifloraPrice: number | null;
  updatedAt: string;
};

type Row = {
  id: string;
  title: string;
  nickname: string | null;
  photo_url: string | null;
  price_mode: "composition" | "fixed";
  fixed_price: number | string | null;
  is_active: boolean;
  sort: number;
  product_id: string | null;
  posiflora_spec_id: string | null;
  posiflora_price: number | string | null;
  updated_at: string;
  pos_recipe_items: { item_id: string; qty: number | string; sort: number }[] | null;
  products:
    | { id: string; name: string; nickname: string | null; slug: string; price: number | string; images: string[] | null; is_active: boolean }
    | { id: string; name: string; nickname: string | null; slug: string; price: number | string; images: string[] | null; is_active: boolean }[]
    | null;
};

const SELECT =
  "id, title, nickname, photo_url, price_mode, fixed_price, is_active, sort, product_id, posiflora_spec_id, posiflora_price, updated_at, " +
  "pos_recipe_items(item_id, qty, sort), products(id, name, nickname, slug, price, images, is_active)";

function toRecipe(r: Row): Recipe {
  const p = one(r.products);
  return {
    id: r.id,
    title: r.title,
    nickname: r.nickname,
    photoUrl: r.photo_url,
    priceMode: r.price_mode,
    fixedPrice: r.fixed_price === null ? null : num(r.fixed_price),
    items: [...(r.pos_recipe_items ?? [])].sort((a, b) => a.sort - b.sort).map((i) => ({ itemId: i.item_id, qty: num(i.qty) })),
    isActive: r.is_active,
    sort: r.sort,
    productId: r.product_id,
    product: p ? { id: p.id, name: p.name, nickname: p.nickname, slug: p.slug, price: num(p.price), image: p.images?.[0] ?? null, isActive: p.is_active } : null,
    posifloraSpecId: r.posiflora_spec_id,
    posifloraPrice: r.posiflora_price === null ? null : num(r.posiflora_price),
    updatedAt: r.updated_at,
  };
}

export async function listRecipes(includeHidden: boolean): Promise<Recipe[]> {
  let q = getSupabaseAdmin().from("pos_recipes").select(SELECT).order("sort").order("title");
  if (!includeHidden) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error(`Рецепты: ${error.message}`);
  return ((data ?? []) as unknown as Row[]).map(toRecipe);
}

export async function listKassaRecipes(): Promise<KassaRecipe[]> {
  return (await listRecipes(false)).map(({ id, title, nickname, photoUrl, priceMode, fixedPrice, items }) => ({ id, title, nickname, photoUrl, priceMode, fixedPrice, items }));
}

/** Букеты сайта — выбрать, какой из них описывает рецепт. */
export async function listSiteProductsForRecipes(): Promise<RecipeProduct[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("products")
    .select("id, name, nickname, slug, price, images, is_active")
    .order("is_active", { ascending: false })
    .order("name");
  if (error) throw new Error(`Букеты сайта: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    nickname: p.nickname,
    slug: p.slug,
    price: num(p.price),
    image: (p.images as string[] | null)?.[0] ?? null,
    isActive: p.is_active,
  }));
}
