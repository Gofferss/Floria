"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaffAction } from "@/lib/auth/server";
import { canUseSiteAdmin, canUseUchetWork } from "@/lib/auth/roles";
import { IMAGE_TYPE_ERROR, imageExtension } from "@/lib/image-upload";
import { posifloraFetch } from "@/lib/posiflora/http";
import { generateProductSlug } from "@/lib/posiflora/slug";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { recipePrice } from "@/lib/uchet/recipe-price";
import { cleanBouquetTitle, mainFlowerKinds, siteCompositionLines } from "@/lib/uchet/recipe-names";

// ================================================================
// Рецепты (039): сохранение, импорт из Posiflora, букет на сайте.
//
// Рецепт правят все, кто работает в учёте: флорист заводит букет, который
// собирает. Сайт — только владельцы и менеджер: обновить букет на сайте
// по рецепту, создать новый, связать рецепт с букетом. Импорт тоже за ними:
// он заводит позиции склада и, пока учёт не запущен, обновляет их цены.
// ================================================================

type Result<T = undefined> = { success: true; data: T } | { success: false; error: string };

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const PHOTO_BUCKET = "product-images";
const MAX_PHOTO_SIZE = 8 * 1024 * 1024;

function refreshUchet() {
  revalidatePath("/uchet", "layout");
}

function refreshSite(slug?: string) {
  revalidatePath("/");
  revalidatePath("/catalog");
  if (slug) revalidatePath(`/catalog/${slug}`);
  revalidatePath("/admin/catalog");
}

// ---------------------------------------------------------------
// Сохранение
// ---------------------------------------------------------------

export type RecipeInput = {
  id: string | null;
  title: string;
  nickname: string;
  photoUrl: string | null;
  priceMode: "composition" | "fixed";
  fixedPrice: number | null;
  items: { itemId: string; qty: number }[];
};

export async function saveRecipe(input: RecipeInput): Promise<Result<{ id: string }>> {
  const staff = await requireStaffAction(canUseUchetWork);
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) return { success: false, error: "Назовите рецепт: «Букет из …»" };
  if (title.length > 160) return { success: false, error: "Название длиннее 160 знаков" };
  const nickname = input.nickname.replace(/\s+/g, " ").trim();
  if (nickname.length > 60) return { success: false, error: "Маленькое название — до 60 знаков" };
  if (input.items.length === 0) return { success: false, error: "Добавьте в рецепт цветы" };
  const seen = new Set<string>();
  for (const [i, l] of input.items.entries()) {
    if (!isUuid(l.itemId)) return { success: false, error: `Строка ${i + 1}: позиция не выбрана` };
    if (!Number.isFinite(l.qty) || l.qty <= 0) return { success: false, error: `Строка ${i + 1}: количество больше нуля` };
    if (seen.has(l.itemId)) return { success: false, error: `Строка ${i + 1}: эта позиция уже в составе` };
    seen.add(l.itemId);
  }
  if (input.priceMode === "fixed" && !(Number(input.fixedPrice) > 0)) return { success: false, error: "Укажите свою цену или выберите «по составу»" };

  const admin = getSupabaseAdmin();
  const row = {
    title,
    nickname: nickname || null,
    photo_url: input.photoUrl,
    price_mode: input.priceMode,
    fixed_price: input.priceMode === "fixed" ? Math.round(Number(input.fixedPrice) * 100) / 100 : null,
  };

  let id = input.id;
  if (id) {
    if (!isUuid(id)) return { success: false, error: "Нет такого рецепта" };
    const { error } = await admin.from("pos_recipes").update(row).eq("id", id);
    if (error) return { success: false, error: `Не удалось сохранить рецепт: ${error.message}` };
  } else {
    const { data, error } = await admin.from("pos_recipes").insert({ ...row, created_by: staff.id }).select("id").single();
    if (error || !data) return { success: false, error: `Не удалось сохранить рецепт: ${error?.message ?? "нет ответа"}` };
    id = data.id as string;
  }

  // Состав — целиком заново: строк немного, а частичная правка путалась бы с порядком.
  const del = await admin.from("pos_recipe_items").delete().eq("recipe_id", id);
  if (del.error) return { success: false, error: `Не удалось обновить состав: ${del.error.message}` };
  const ins = await admin.from("pos_recipe_items").insert(input.items.map((l, i) => ({ recipe_id: id, item_id: l.itemId, qty: l.qty, sort: i })));
  if (ins.error) return { success: false, error: `Состав не сохранился: ${ins.error.message}. Откройте рецепт и сохраните ещё раз.` };

  refreshUchet();
  return { success: true, data: { id: id as string } };
}

/** Рецепты не удаляются: ненужный скрывают, и он остаётся в истории. */
export async function setRecipeActive(id: string, active: boolean): Promise<Result> {
  await requireStaffAction(canUseUchetWork);
  if (!isUuid(id)) return { success: false, error: "Нет такого рецепта" };
  const { error } = await getSupabaseAdmin().from("pos_recipes").update({ is_active: active }).eq("id", id);
  if (error) return { success: false, error: error.message };
  refreshUchet();
  return { success: true, data: undefined };
}

/** Фото рецепта. Файл уже ужат в браузере (lib/prepare-image.ts). */
export async function uploadRecipePhoto(formData: FormData): Promise<Result<{ url: string }>> {
  await requireStaffAction(canUseUchetWork);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { success: false, error: "Файл не выбран" };
  const ext = imageExtension(file.type);
  if (!ext) return { success: false, error: IMAGE_TYPE_ERROR };
  if (file.size > MAX_PHOTO_SIZE) return { success: false, error: "Фото больше 8 МБ" };
  const path = `recipes/${randomUUID()}.${ext}`;
  const admin = getSupabaseAdmin();
  const { error } = await admin.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (error) return { success: false, error: "Не удалось загрузить фото" };
  return { success: true, data: { url: admin.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl } };
}

// ---------------------------------------------------------------
// Букет на сайте
// ---------------------------------------------------------------

type RecipeForSite = {
  id: string;
  title: string;
  nickname: string | null;
  photo_url: string | null;
  price_mode: "composition" | "fixed";
  fixed_price: number | string | null;
  product_id: string | null;
  pos_recipe_items: { item_id: string; qty: number | string; sort: number; inv_items: { title: string; sale_price: number | string | null } | { title: string; sale_price: number | string | null }[] | null }[];
};

async function loadForSite(id: string): Promise<RecipeForSite | null> {
  const { data } = await getSupabaseAdmin()
    .from("pos_recipes")
    .select("id, title, nickname, photo_url, price_mode, fixed_price, product_id, pos_recipe_items(item_id, qty, sort, inv_items(title, sale_price))")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as RecipeForSite) ?? null;
}

function siteFields(r: RecipeForSite) {
  const items = [...r.pos_recipe_items].sort((a, b) => a.sort - b.sort).map((l) => {
    const it = Array.isArray(l.inv_items) ? l.inv_items[0] : l.inv_items;
    return { itemId: l.item_id, qty: Number(l.qty), title: it?.title ?? "", price: it?.sale_price === null || it?.sale_price === undefined ? null : Number(it.sale_price) };
  });
  const price = recipePrice(
    { priceMode: r.price_mode, fixedPrice: r.fixed_price === null ? null : Number(r.fixed_price), items },
    (itemId) => items.find((i) => i.itemId === itemId)?.price
  );
  return { items, price, composition: siteCompositionLines(items) };
}

/**
 * Обновить букет на сайте по рецепту: название, маленькое название, цена,
 * состав. Фото и раздел каталога не трогаем — их ведут в админке сайта.
 * Прежние название и цена сохраняются в attributes.beforeRecipe — один раз,
 * чтобы было видно и можно было вернуть то, что было до рецептов.
 */
export async function applyRecipeToSite(id: string): Promise<Result<{ slug: string; price: number }>> {
  await requireStaffAction(canUseSiteAdmin);
  if (!isUuid(id)) return { success: false, error: "Нет такого рецепта" };
  const r = await loadForSite(id);
  if (!r) return { success: false, error: "Нет такого рецепта" };
  if (!r.product_id) return { success: false, error: "Рецепт не связан с букетом на сайте — выберите букет или создайте новый" };
  const { items, price, composition } = siteFields(r);
  if (price.unpriced.length) return { success: false, error: `У ${price.unpriced.length === 1 ? "позиции" : `${price.unpriced.length} позиций`} в составе нет цены — сначала поставьте цену на складе` };
  if (!(price.price > 0)) return { success: false, error: "У рецепта нет цены" };
  if (items.length === 0) return { success: false, error: "В рецепте нет состава" };

  const admin = getSupabaseAdmin();
  const { data: product } = await admin.from("products").select("id, slug, name, price, nickname, attributes").eq("id", r.product_id).maybeSingle();
  if (!product) return { success: false, error: "Букет на сайте не найден — свяжите рецепт заново" };
  const attributes = (product.attributes ?? {}) as Record<string, unknown>;
  const next = {
    ...attributes,
    composition,
    beforeRecipe: attributes.beforeRecipe ?? { name: product.name, price: Number(product.price), nickname: product.nickname ?? null, composition: attributes.composition ?? null, at: new Date().toISOString() },
  };
  const { error } = await admin
    .from("products")
    .update({ name: r.title, nickname: r.nickname, price: Math.round(price.price), attributes: next })
    .eq("id", product.id);
  if (error) return { success: false, error: `Сайт не обновился: ${error.message}` };
  refreshSite(product.slug);
  refreshUchet();
  return { success: true, data: { slug: product.slug, price: Math.round(price.price) } };
}

/** Новый букет на сайте из рецепта: один вид — «Монобукет», несколько — «Авторские букеты». */
export async function createSiteProductFromRecipe(id: string): Promise<Result<{ slug: string }>> {
  await requireStaffAction(canUseSiteAdmin);
  if (!isUuid(id)) return { success: false, error: "Нет такого рецепта" };
  const r = await loadForSite(id);
  if (!r) return { success: false, error: "Нет такого рецепта" };
  if (r.product_id) return { success: false, error: "Рецепт уже связан с букетом на сайте" };
  if (!r.photo_url) return { success: false, error: "Без фото букет на сайт не ставим — добавьте фото в рецепт" };
  const { items, price, composition } = siteFields(r);
  if (price.unpriced.length || !(price.price > 0)) return { success: false, error: "У рецепта нет полной цены — проверьте цены позиций на складе" };

  const admin = getSupabaseAdmin();
  const categorySlug = mainFlowerKinds(items) <= 1 ? "mono-buket" : "avtorskie-bukety";
  const { data: cat } = await admin.from("product_categories").select("id").eq("slug", categorySlug).maybeSingle();
  if (!cat) return { success: false, error: `На сайте нет раздела «${categorySlug}»` };

  const slug = generateProductSlug(r.title, r.id);
  const { data, error } = await admin
    .from("products")
    .insert({
      posiflora_product_id: `recipe:${r.id}`,
      category_id: cat.id,
      name: r.title,
      nickname: r.nickname,
      slug,
      description: null,
      price: Math.round(price.price),
      stock_quantity: 0,
      is_available: true,
      is_active: true,
      // Букет по рецепту собирают из того, что в магазине, — в тот же день.
      availability_mode: "in_stock",
      pricing_mode: "bouquet",
      availability_source: "manual",
      images: [r.photo_url],
      attributes: { composition, sizes: [{ id: "std", label: "Стандарт", priceModifier: 0 }], source: "recipe" },
    })
    .select("id, slug")
    .single();
  if (error || !data) return { success: false, error: `Букет на сайте не создался: ${error?.message ?? "нет ответа"}` };
  await admin.from("pos_recipes").update({ product_id: data.id }).eq("id", r.id);
  refreshSite(data.slug);
  refreshUchet();
  return { success: true, data: { slug: data.slug } };
}

export async function linkRecipeToProduct(id: string, productId: string | null): Promise<Result> {
  await requireStaffAction(canUseSiteAdmin);
  if (!isUuid(id) || (productId !== null && !isUuid(productId))) return { success: false, error: "Неверный букет" };
  const { error } = await getSupabaseAdmin().from("pos_recipes").update({ product_id: productId }).eq("id", id);
  if (error) return { success: false, error: error.message };
  refreshUchet();
  return { success: true, data: undefined };
}

// ---------------------------------------------------------------
// Импорт из Posiflora (только чтение там)
// ---------------------------------------------------------------

type ApiObj = { id: string; type: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id: string; type: string } | { id: string; type: string }[] | null }> };
type ApiList = { data?: ApiObj[]; included?: ApiObj[] };

function rel(o: ApiObj | undefined, name: string): { id: string; type: string }[] {
  const d = o?.relationships?.[name]?.data;
  return !d ? [] : Array.isArray(d) ? d : [d];
}

/** Отпечаток картинки 8×8 (разностный хэш): одинаковые фото дают почти одинаковые биты. */
async function photoHash(url: string): Promise<number[] | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const raw = await sharp(Buffer.from(await r.arrayBuffer())).resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer();
    const bits: number[] = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(raw[y * 9 + x] < raw[y * 9 + x + 1] ? 1 : 0);
    return bits;
  } catch {
    return null;
  }
}

const hamming = (a: number[], b: number[]) => a.reduce((s, bit, i) => s + (bit !== b[i] ? 1 : 0), 0);

async function pool<T>(list: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < list.length) await fn(list[i++]);
  }));
}

export type ImportReport = {
  created: string[];
  skipped: number;
  linked: number;
  itemsCreated: string[];
  itemsRefreshed: string[];
  problems: string[];
};

/**
 * Рецепты Posiflora → рецепты учёта. Уже перенесённые (по id спецификации)
 * пропускаются — повторный импорт ничего не задвоит и не затрёт правки.
 *
 * Позиции, которых в учёте нет, заводятся. Пока учёт не запущен (основное
 * место — «Тренировка»), у позиций из рецептов обновляются название, цена
 * и видимость по Posiflora: там их сейчас и ведут. После запуска цены
 * ведёт учёт, и импорт их не трогает.
 *
 * Букет на сайте связывается сам, если фото рецепта совпало с фото
 * букета; иначе связь выбирают руками.
 */
export async function importRecipesFromPosiflora(): Promise<Result<ImportReport>> {
  const staff = await requireStaffAction(canUseSiteAdmin);
  const admin = getSupabaseAdmin();
  const report: ImportReport = { created: [], skipped: 0, linked: 0, itemsCreated: [], itemsRefreshed: [], problems: [] };

  let specs: ApiObj[] = [];
  try {
    for (let page = 1; page < 20; page++) {
      const j = (await posifloraFetch(`/specifications?page[size]=50&page[number]=${page}`)) as ApiList;
      specs.push(...(j.data ?? []));
      if ((j.data ?? []).length < 50) break;
    }
  } catch (e) {
    return { success: false, error: `Posiflora не ответила: ${e instanceof Error ? e.message : "нет связи"}` };
  }
  specs = specs.filter((s) => s.attributes?.status === "on");

  const { data: existing } = await admin.from("pos_recipes").select("posiflora_spec_id").not("posiflora_spec_id", "is", null);
  const done = new Set((existing ?? []).map((r) => r.posiflora_spec_id as string));
  const todo = specs.filter((s) => !done.has(s.id));
  report.skipped = specs.length - todo.length;
  if (todo.length === 0) return { success: true, data: report };

  const location = await getDefaultLocation();
  const launched = !location.isTraining;

  type Parsed = { spec: ApiObj; items: { posiId: string; qty: number; attrs: Record<string, unknown> }[]; price: number | null; fixed: boolean; photo: string | null };
  const parsed: Parsed[] = [];
  await pool(todo, 3, async (spec) => {
    try {
      const v = (await posifloraFetch(`/specification-with-variants?filter[specification]=${spec.id}&include=specItems,specItems.item,specVariantPrices`)) as ApiList;
      const inc = new Map((v.included ?? []).map((x) => [`${x.type}:${x.id}`, x]));
      const variants = v.data ?? [];
      const variant = variants.find((x) => x.attributes?.isDefault) ?? variants[0];
      if (!variant) return void report.problems.push(`«${spec.attributes?.title}»: нет варианта состава`);
      const items = rel(variant, "specItems")
        .map((d) => inc.get(`${d.type}:${d.id}`))
        .filter((x): x is ApiObj => !!x)
        .map((x) => {
          const it = rel(x, "item")[0];
          return { posiId: it?.id ?? "", qty: Number(x.attributes?.qty) || 0, attrs: (it ? inc.get(`${it.type}:${it.id}`)?.attributes : null) ?? {} };
        })
        .filter((x) => x.posiId && x.qty > 0);
      const priceRow = rel(variant, "specVariantPrices").map((d) => inc.get(`${d.type}:${d.id}`)?.attributes).find(Boolean);
      let photo: string | null = null;
      try {
        const im = (await posifloraFetch(`/specifications/${spec.id}?include=images`)) as { included?: ApiObj[] };
        const a = (im.included ?? []).find((x) => x.type === "images")?.attributes;
        photo = (a?.fileMedium as string) || (a?.file as string) || null;
      } catch {
        photo = null;
      }
      parsed.push({ spec, items, price: priceRow ? Number(priceRow.priceValue) || null : null, fixed: !!priceRow?.fixPrice, photo });
    } catch (e) {
      report.problems.push(`«${spec.attributes?.title}»: ${e instanceof Error ? e.message : "не прочитался"}`);
    }
  });

  // Позиции склада: найти, недостающие завести, до запуска — освежить.
  const posiIds = [...new Set(parsed.flatMap((p) => p.items.map((i) => i.posiId)))];
  const { data: known } = await admin.from("inv_items").select("id, posiflora_id, title, sale_price, is_active").in("posiflora_id", posiIds.length ? posiIds : ["-"]);
  const byPosi = new Map((known ?? []).map((k) => [k.posiflora_id as string, k]));
  for (const p of parsed) {
    for (const it of p.items) {
      const a = it.attrs;
      const title = String(a.title ?? "").replace(/\s+/g, " ").trim() || "Позиция из Posiflora";
      const priceMax = Number(a.priceMax) || 0;
      const have = byPosi.get(it.posiId);
      if (!have) {
        const { data: created, error } = await admin
          .from("inv_items")
          .insert({
            title,
            posiflora_id: it.posiId,
            unit_code: "pcs",
            fractional: !!a.fractional,
            is_tracked: a.itemType !== "service",
            sale_price: priceMax > 0 ? priceMax : null,
            is_active: true,
          })
          .select("id, posiflora_id, title, sale_price, is_active")
          .single();
        if (error || !created) {
          report.problems.push(`Позиция «${title}» не завелась: ${error?.message ?? "нет ответа"}`);
          continue;
        }
        byPosi.set(it.posiId, created);
        report.itemsCreated.push(title);
      } else if (!launched) {
        const patch: Record<string, unknown> = {};
        if (have.title !== title) patch.title = title;
        if (priceMax > 0 && Number(have.sale_price) !== priceMax) patch.sale_price = priceMax;
        if (!have.is_active) patch.is_active = true;
        if (Object.keys(patch).length) {
          const { error } = await admin.from("inv_items").update(patch).eq("id", have.id);
          if (error) report.problems.push(`«${title}» не обновилась: ${error.message}`);
          else {
            report.itemsRefreshed.push(`${have.title}${patch.sale_price ? ` → ${priceMax} ₽` : ""}${patch.title ? ` → «${title}»` : ""}${patch.is_active ? " (снова видна)" : ""}`);
            Object.assign(have, patch);
          }
        }
      }
    }
  }

  // Фото букетов сайта — для автосвязи по совпадению фото.
  const { data: products } = await admin.from("products").select("id, images").eq("is_active", true);
  const productHashes: { id: string; hash: number[] }[] = [];
  await pool(
    (products ?? []).filter((p) => (p.images as string[] | null)?.[0]),
    6,
    async (p) => {
      const h = await photoHash((p.images as string[])[0]);
      if (h) productHashes.push({ id: p.id as string, hash: h });
    }
  );

  for (const p of parsed) {
    const rawTitle = String(p.spec.attributes?.title ?? "Букет");
    let photoUrl: string | null = null;
    let productId: string | null = null;
    if (p.photo) {
      try {
        const r = await fetch(p.photo, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error(String(r.status));
        const buf = Buffer.from(await r.arrayBuffer());
        const path = `recipes/${randomUUID()}.jpg`;
        const up = await admin.storage.from(PHOTO_BUCKET).upload(path, buf, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
        if (up.error) throw new Error(up.error.message);
        photoUrl = admin.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
        const hash = await photoHash(p.photo);
        if (hash && productHashes.length) {
          const ranked = productHashes.map((x) => ({ id: x.id, d: hamming(hash, x.hash) })).sort((a, b) => a.d - b.d);
          // Совпадение — только явное: близко к одному и далеко от остальных.
          if (ranked[0].d <= 10 && (ranked[1]?.d ?? 64) - ranked[0].d >= 5) productId = ranked[0].id;
        }
      } catch (e) {
        report.problems.push(`«${rawTitle}»: фото не перенеслось (${e instanceof Error ? e.message : "ошибка"})`);
      }
    }

    const lines = p.items.map((i) => ({ item: byPosi.get(i.posiId), qty: i.qty })).filter((l) => l.item);
    if (lines.length < p.items.length) report.problems.push(`«${rawTitle}»: часть состава не нашлась на складе`);
    const merged = new Map<string, number>();
    for (const l of lines) merged.set(l.item!.id as string, (merged.get(l.item!.id as string) ?? 0) + l.qty);

    const { data: rec, error } = await admin
      .from("pos_recipes")
      .insert({
        title: cleanBouquetTitle(rawTitle),
        photo_url: photoUrl,
        price_mode: p.fixed && p.price ? "fixed" : "composition",
        fixed_price: p.fixed && p.price ? p.price : null,
        posiflora_spec_id: p.spec.id,
        posiflora_price: p.price,
        product_id: productId,
        created_by: staff.id,
      })
      .select("id")
      .single();
    if (error || !rec) {
      report.problems.push(`«${rawTitle}» не перенёсся: ${error?.message ?? "нет ответа"}`);
      continue;
    }
    const ins = await admin.from("pos_recipe_items").insert([...merged.entries()].map(([itemId, qty], i) => ({ recipe_id: rec.id, item_id: itemId, qty, sort: i })));
    if (ins.error) report.problems.push(`«${rawTitle}»: состав не сохранился — ${ins.error.message}`);
    report.created.push(cleanBouquetTitle(rawTitle));
    if (productId) report.linked++;
  }

  refreshUchet();
  return { success: true, data: report };
}
