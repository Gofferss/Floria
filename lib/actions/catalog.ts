"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { searchInventoryItems, type InventoryItemOption } from "@/lib/posiflora";
import { parsePricingMode, type AvailabilityMode, type Occasion, type PricingMode, type ProductSize } from "@/lib/products";

// ================================================================
// Server Actions для ручного редактирования каталога в /admin/catalog.
// Товары, которые приходят из Posiflora (lib/posiflora/catalog.ts),
// тоже можно редактировать здесь — синк трогает только name/description/
// price/category_id/is_available и никогда не трогает availability_mode,
// attributes (sizes/occasions/composition) или images, так что правки
// куратора переживают следующий синк.
//
// Товары, созданные вручную (не из Posiflora), получают
// posiflora_product_id вида 'admin:<uuid>' — по аналогии с 'seed:'
// у сид-данных. Синк специально исключает оба префикса из чистки
// пропавших товаров (см. syncPosifloraCatalog).
// ================================================================

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

export type AdminCategory = { id: string; name: string; slug: string };

/** Категории для выпадающего списка в форме товара. */
export async function getCatalogCategories(): Promise<AdminCategory[]> {
  await requireStaff();

  const { data, error } = await getSupabaseAdmin()
    .from("product_categories")
    .select("id, name, slug")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getCatalogCategories]", error.message);
    return [];
  }
  return data ?? [];
}

export type AvailabilitySource = "manual" | "recipe";

export type RecipeItemInput = {
  posifloraInventoryItemId: string;
  itemName: string;
  quantity: number;
};

export type ProductInput = {
  name: string;
  slug: string;
  categoryId: string;
  description: string;
  price: number;
  oldPrice: number | null;
  stockQuantity: number;
  availabilityMode: AvailabilityMode;
  pricingMode: PricingMode;
  availabilitySource: AvailabilitySource;
  recipeItems: RecipeItemInput[];
  isActive: boolean;
  images: string[];
  occasions: Occasion[];
  composition: string[];
  sizes: ProductSize[];
};

function validateProductInput(input: ProductInput): string | null {
  if (!input.name.trim()) return "Укажите название букета";
  if (!input.slug.trim()) return "Укажите URL-адрес (slug)";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug.trim())) {
    return "URL-адрес может содержать только латиницу, цифры и дефисы";
  }
  if (!input.categoryId) return "Выберите категорию";
  if (!Number.isFinite(input.price) || input.price <= 0) return "Укажите цену больше нуля";
  if (input.oldPrice !== null && input.oldPrice < input.price) {
    return "Старая цена не может быть меньше текущей";
  }
  if (input.sizes.length === 0) return "Добавьте хотя бы один размер";
  if (input.availabilitySource === "recipe" && input.recipeItems.length === 0) {
    return "Добавьте хотя бы один ингредиент в состав или переключите наличие обратно на ручное";
  }
  return null;
}

/** Полная замена рецепта товара — проще и надёжнее построчного diff при таком небольшом объёме строк. */
async function replaceRecipeItems(productId: string, items: RecipeItemInput[]): Promise<string | null> {
  const supabaseAdmin = getSupabaseAdmin();

  const { error: deleteError } = await supabaseAdmin
    .from("product_recipe_items")
    .delete()
    .eq("product_id", productId);
  if (deleteError) return `Не удалось обновить состав: ${deleteError.message}`;

  if (items.length === 0) return null;

  const { error: insertError } = await supabaseAdmin.from("product_recipe_items").insert(
    items.map((item) => ({
      product_id: productId,
      posiflora_inventory_item_id: item.posifloraInventoryItemId,
      item_name: item.itemName,
      quantity: item.quantity,
    }))
  );
  if (insertError) return `Не удалось сохранить состав: ${insertError.message}`;

  return null;
}

function buildAttributes(input: ProductInput) {
  return {
    sizes: input.sizes,
    // Список активных поводов теперь в таблице occasions (см.
    // lib/occasions.ts), а не в хардкоженном наборе — здесь просто
    // сохраняем то, что отметили в форме, без сверки со списком.
    occasions: input.occasions.map((o) => o.trim()).filter(Boolean),
    composition: input.composition.map((c) => c.trim()).filter(Boolean),
  };
}

export async function createProduct(
  input: ProductInput
): Promise<ActionResult<{ id: string; slug: string }>> {
  await requireStaff();

  const validationError = validateProductInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data: product, error } = await getSupabaseAdmin()
    .from("products")
    .insert({
      posiflora_product_id: `admin:${randomUUID()}`,
      category_id: input.categoryId,
      name: input.name.trim(),
      slug: input.slug.trim(),
      description: input.description.trim() || null,
      price: input.price,
      old_price: input.oldPrice,
      stock_quantity: input.stockQuantity,
      is_available: true,
      is_active: input.isActive,
      availability_mode: input.availabilityMode,
      pricing_mode: input.pricingMode,
      availability_source: input.availabilitySource,
      images: input.images,
      attributes: buildAttributes(input),
    })
    .select("id, slug")
    .single();

  if (error || !product) {
    console.error("[createProduct]", error?.message);
    if (error?.code === "23505") {
      return { success: false, error: "Товар с таким URL-адресом уже существует" };
    }
    return { success: false, error: "Не удалось сохранить товар" };
  }

  const recipeError = await replaceRecipeItems(product.id, input.recipeItems);
  if (recipeError) return { success: false, error: recipeError };

  revalidatePath("/admin/catalog");
  revalidatePath("/catalog");
  if (input.isActive) revalidatePath(`/catalog/${product.slug}`);

  return { success: true, data: { id: product.id, slug: product.slug } };
}

export async function updateProduct(
  id: string,
  input: ProductInput
): Promise<ActionResult<{ id: string; slug: string }>> {
  await requireStaff();

  const validationError = validateProductInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data: oldProduct } = await getSupabaseAdmin()
    .from("products")
    .select("slug")
    .eq("id", id)
    .maybeSingle();

  const { data: product, error } = await getSupabaseAdmin()
    .from("products")
    .update({
      category_id: input.categoryId,
      name: input.name.trim(),
      slug: input.slug.trim(),
      description: input.description.trim() || null,
      price: input.price,
      old_price: input.oldPrice,
      stock_quantity: input.stockQuantity,
      is_active: input.isActive,
      availability_mode: input.availabilityMode,
      pricing_mode: input.pricingMode,
      availability_source: input.availabilitySource,
      images: input.images,
      attributes: buildAttributes(input),
    })
    .eq("id", id)
    .select("id, slug")
    .single();

  if (error || !product) {
    console.error("[updateProduct]", error?.message);
    if (error?.code === "23505") {
      return { success: false, error: "Товар с таким URL-адресом уже существует" };
    }
    return { success: false, error: "Не удалось сохранить товар" };
  }

  const recipeError = await replaceRecipeItems(product.id, input.recipeItems);
  if (recipeError) return { success: false, error: recipeError };

  revalidatePath("/admin/catalog");
  revalidatePath("/catalog");
  revalidatePath(`/catalog/${product.slug}`);
  if (oldProduct && oldProduct.slug !== product.slug) revalidatePath(`/catalog/${oldProduct.slug}`);

  return { success: true, data: { id: product.id, slug: product.slug } };
}

/** Показать/скрыть товар в каталоге — без удаления строки (на неё могут ссылаться заказы). */
export async function toggleProductActive(id: string, isActive: boolean): Promise<ActionResult<null>> {
  await requireStaff();

  const { error } = await getSupabaseAdmin().from("products").update({ is_active: isActive }).eq("id", id);

  if (error) {
    console.error("[toggleProductActive]", error.message);
    return { success: false, error: "Не удалось изменить статус товара" };
  }

  revalidatePath("/admin/catalog");
  revalidatePath("/catalog");
  return { success: true, data: null };
}

/**
 * Удаляет товар насовсем.
 *
 * История заказов не пострадает: order_items хранит product_name, unit_price
 * и quantity снимком на момент покупки, а внешний ключ product_id объявлен с
 * ON DELETE SET NULL. В заказе останется всё, что нужно для чека, — исчезнет
 * только ссылка на карточку.
 *
 * Важное ограничение: товар, пришедший из Posiflora, синхронизация заведёт
 * заново при следующем прогоне — удалять имеет смысл только то, что создано
 * вручную (posiflora_product_id вида seed: или admin:). Для товаров из CRM
 * правильный инструмент — скрытие через toggleProductActive.
 */
export async function deleteProduct(id: string): Promise<ActionResult<null>> {
  await requireStaff();

  const { error } = await getSupabaseAdmin().from("products").delete().eq("id", id);

  if (error) {
    console.error("[deleteProduct]", error.message);
    return { success: false, error: "Не удалось удалить товар" };
  }

  revalidatePath("/admin/catalog");
  revalidatePath("/catalog");
  revalidatePath("/");
  return { success: true, data: null };
}

export type AdminProductDetail = ProductInput & { id: string };

/** Один товар для формы редактирования — включая скрытые. */
export async function getProductForEdit(id: string): Promise<AdminProductDetail | null> {
  await requireStaff();

  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from("products")
    .select(
      "id, name, slug, category_id, description, price, old_price, stock_quantity, is_active, availability_mode, availability_source, pricing_mode, images, attributes"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const { data: recipeRows } = await supabaseAdmin
    .from("product_recipe_items")
    .select("posiflora_inventory_item_id, item_name, quantity")
    .eq("product_id", id)
    .order("created_at", { ascending: true });

  const attributes = (data.attributes ?? {}) as {
    sizes?: ProductSize[];
    occasions?: Occasion[];
    composition?: string[];
  };

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    categoryId: data.category_id ?? "",
    description: data.description ?? "",
    price: Number(data.price),
    oldPrice: data.old_price === null ? null : Number(data.old_price),
    stockQuantity: data.stock_quantity,
    availabilityMode: data.availability_mode === "made_to_order" ? "made_to_order" : "in_stock",
    pricingMode: parsePricingMode(data.pricing_mode),
    availabilitySource: data.availability_source === "recipe" ? "recipe" : "manual",
    recipeItems: (recipeRows ?? []).map((r) => ({
      posifloraInventoryItemId: r.posiflora_inventory_item_id,
      itemName: r.item_name,
      quantity: Number(r.quantity),
    })),
    isActive: data.is_active,
    images: (data.images as string[]) ?? [],
    occasions: attributes.occasions ?? [],
    composition: attributes.composition ?? [],
    sizes: attributes.sizes?.length ? attributes.sizes : [{ id: "std", label: "Стандарт", priceModifier: 0 }],
  };
}

/** Поиск позиций склада Posiflora для автокомплита в форме рецепта. */
export async function searchInventoryItemsAction(query: string): Promise<InventoryItemOption[]> {
  await requireStaff();
  try {
    return await searchInventoryItems(query);
  } catch (error) {
    console.error("[searchInventoryItemsAction]", error);
    return [];
  }
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const PRODUCT_IMAGES_BUCKET = "product-images";

export async function uploadProductImage(formData: FormData): Promise<ActionResult<{ url: string }>> {
  await requireStaff();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Файл не выбран" };
  }
  if (!file.type.startsWith("image/")) {
    return { success: false, error: "Можно загружать только изображения" };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { success: false, error: "Максимальный размер файла — 5 МБ" };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `products/${randomUUID()}.${ext}`;

  const { error: uploadError } = await getSupabaseAdmin()
    .storage.from(PRODUCT_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });

  if (uploadError) {
    console.error("[uploadProductImage]", uploadError.message);
    return { success: false, error: "Не удалось загрузить изображение" };
  }

  const {
    data: { publicUrl },
  } = getSupabaseAdmin().storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);

  return { success: true, data: { url: publicUrl } };
}
