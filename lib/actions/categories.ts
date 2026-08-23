"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Server Actions для /admin/categories. Категории, синхронизированные
// из Posiflora (lib/posiflora/catalog.ts), тоже можно редактировать
// здесь — синк трогает только name/is_active и никогда не трогает
// subtitle/image_url/sort_order, так что правки куратора переживают
// следующий синк. Категории, созданные вручную, получают
// posiflora_category_id = null (колонка nullable и unique, несколько
// NULL допустимы) — синк их не видит и не тронет.
// ================================================================

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

export type AdminCategoryDetail = {
  id: string;
  name: string;
  slug: string;
  subtitle: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Сколько товаров привязано — нужно, чтобы предупредить перед удалением. */
  productCount: number;
};

export type CategoryInput = {
  name: string;
  slug: string;
  subtitle: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
};

function validateCategoryInput(input: CategoryInput): string | null {
  if (!input.name.trim()) return "Укажите название категории";
  if (!input.slug.trim()) return "Укажите URL-адрес (slug)";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug.trim())) {
    return "URL-адрес может содержать только латиницу, цифры и дефисы";
  }
  return null;
}

export async function listCategoriesAdmin(): Promise<AdminCategoryDetail[]> {
  await requireStaff();

  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from("product_categories")
    .select("id, name, slug, subtitle, image_url, sort_order, is_active")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[listCategoriesAdmin]", error.message);
    return [];
  }

  // Считаем товары одним запросом на всю таблицу, а не по запросу на
  // категорию: категорий единицы, товаров тоже немного, зато не плодим
  // N+1 обращений к базе на каждую отрисовку списка.
  const { data: productRows } = await supabaseAdmin
    .from("products")
    .select("category_id")
    .not("category_id", "is", null);

  const counts = new Map<string, number>();
  for (const row of productRows ?? []) {
    counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    subtitle: row.subtitle ?? "",
    imageUrl: row.image_url,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    productCount: counts.get(row.id) ?? 0,
  }));
}

export async function getCategoryForEdit(id: string): Promise<AdminCategoryDetail | null> {
  await requireStaff();

  const { data, error } = await getSupabaseAdmin()
    .from("product_categories")
    .select("id, name, slug, subtitle, image_url, sort_order, is_active")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const { count } = await getSupabaseAdmin()
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    subtitle: data.subtitle ?? "",
    imageUrl: data.image_url,
    sortOrder: data.sort_order,
    isActive: data.is_active,
    productCount: count ?? 0,
  };
}

export async function createCategory(input: CategoryInput): Promise<ActionResult<{ id: string }>> {
  await requireStaff();

  const validationError = validateCategoryInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data: category, error } = await getSupabaseAdmin()
    .from("product_categories")
    .insert({
      name: input.name.trim(),
      slug: input.slug.trim(),
      subtitle: input.subtitle.trim() || null,
      image_url: input.imageUrl,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    })
    .select("id")
    .single();

  if (error || !category) {
    console.error("[createCategory]", error?.message);
    if (error?.code === "23505") {
      return { success: false, error: "Категория с таким URL-адресом уже существует" };
    }
    return { success: false, error: "Не удалось сохранить категорию" };
  }

  revalidatePath("/admin/categories");
  revalidatePath("/");
  revalidatePath("/catalog");

  return { success: true, data: { id: category.id } };
}

export async function updateCategory(id: string, input: CategoryInput): Promise<ActionResult<{ id: string }>> {
  await requireStaff();

  const validationError = validateCategoryInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data: category, error } = await getSupabaseAdmin()
    .from("product_categories")
    .update({
      name: input.name.trim(),
      slug: input.slug.trim(),
      subtitle: input.subtitle.trim() || null,
      image_url: input.imageUrl,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !category) {
    console.error("[updateCategory]", error?.message);
    if (error?.code === "23505") {
      return { success: false, error: "Категория с таким URL-адресом уже существует" };
    }
    return { success: false, error: "Не удалось сохранить категорию" };
  }

  revalidatePath("/admin/categories");
  revalidatePath("/");
  revalidatePath("/catalog");

  return { success: true, data: { id: category.id } };
}

/** Скрыть/показать категорию — не удаляем строку, на неё ссылаются товары (category_id). */
export async function toggleCategoryActive(id: string, isActive: boolean): Promise<ActionResult<null>> {
  await requireStaff();

  const { error } = await getSupabaseAdmin()
    .from("product_categories")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) {
    console.error("[toggleCategoryActive]", error.message);
    return { success: false, error: "Не удалось изменить статус категории" };
  }

  revalidatePath("/admin/categories");
  revalidatePath("/");
  revalidatePath("/catalog");
  return { success: true, data: null };
}

/**
 * Удаляет категорию насовсем.
 *
 * Товары при этом НЕ удаляются: внешний ключ products.category_id объявлен
 * с ON DELETE SET NULL, поэтому они просто остаются без категории и их можно
 * разложить заново. Сколько товаров это затронет, интерфейс показывает в
 * подтверждении — считается в listCategoriesAdmin.
 *
 * Мягкое скрытие (toggleCategoryActive) никуда не делось и остаётся верным
 * выбором для сезонных категорий вроде «Тюльпаны к 8 марта»: скрыл до весны,
 * вернул обратно. Удаление — для того, что заведено по ошибке.
 */
export async function deleteCategory(id: string): Promise<ActionResult<null>> {
  await requireStaff();

  const { error } = await getSupabaseAdmin().from("product_categories").delete().eq("id", id);

  if (error) {
    console.error("[deleteCategory]", error.message);
    return { success: false, error: "Не удалось удалить категорию" };
  }

  revalidatePath("/admin/categories");
  revalidatePath("/");
  revalidatePath("/catalog");
  return { success: true, data: null };
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const CATEGORY_IMAGES_BUCKET = "product-images";

export async function uploadCategoryImage(formData: FormData): Promise<ActionResult<{ url: string }>> {
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
  const path = `categories/${randomUUID()}.${ext}`;

  const { error: uploadError } = await getSupabaseAdmin()
    .storage.from(CATEGORY_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });

  if (uploadError) {
    console.error("[uploadCategoryImage]", uploadError.message);
    return { success: false, error: "Не удалось загрузить изображение" };
  }

  const {
    data: { publicUrl },
  } = getSupabaseAdmin().storage.from(CATEGORY_IMAGES_BUCKET).getPublicUrl(path);

  return { success: true, data: { url: publicUrl } };
}
