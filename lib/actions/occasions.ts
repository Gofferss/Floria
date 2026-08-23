"use server";

import { revalidatePath } from "next/cache";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

export type AdminOccasion = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** Сколько товаров отмечено этим поводом — предупреждение перед удалением. */
  productCount: number;
};

export async function listOccasionsAdmin(): Promise<AdminOccasion[]> {
  await requireStaff();

  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from("occasions")
    .select("id, name, sort_order, is_active")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[listOccasionsAdmin]", error.message);
    return [];
  }

  // У поводов нет внешнего ключа: товар хранит повод строкой в
  // attributes.occasions и сверяется по имени (см. lib/occasions.ts).
  // Поэтому считаем вручную по выгрузке attributes.
  const { data: productRows } = await supabaseAdmin.from("products").select("attributes");

  const counts = new Map<string, number>();
  for (const row of productRows ?? []) {
    const names = (row.attributes as { occasions?: unknown } | null)?.occasions;
    if (!Array.isArray(names)) continue;
    for (const name of names) {
      if (typeof name !== "string") continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    productCount: counts.get(row.name) ?? 0,
  }));
}

export async function createOccasion(name: string, sortOrder: number): Promise<ActionResult<{ id: string }>> {
  await requireStaff();

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Укажите название повода" };

  const { data, error } = await getSupabaseAdmin()
    .from("occasions")
    .insert({ name: trimmed, sort_order: sortOrder })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[createOccasion]", error?.message);
    if (error?.code === "23505") return { success: false, error: "Такой повод уже есть" };
    return { success: false, error: "Не удалось сохранить повод" };
  }

  revalidatePath("/admin/occasions");
  revalidatePath("/catalog");
  return { success: true, data: { id: data.id } };
}

export async function updateOccasion(
  id: string,
  name: string,
  sortOrder: number
): Promise<ActionResult<null>> {
  await requireStaff();

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Укажите название повода" };

  const { error } = await getSupabaseAdmin()
    .from("occasions")
    .update({ name: trimmed, sort_order: sortOrder })
    .eq("id", id);

  if (error) {
    console.error("[updateOccasion]", error.message);
    if (error.code === "23505") return { success: false, error: "Такой повод уже есть" };
    return { success: false, error: "Не удалось сохранить повод" };
  }

  revalidatePath("/admin/occasions");
  revalidatePath("/catalog");
  return { success: true, data: null };
}

/** Скрыть/показать повод — не удаляем строку, на неё могут ссылаться товары (по имени). */
export async function toggleOccasionActive(id: string, isActive: boolean): Promise<ActionResult<null>> {
  await requireStaff();

  const { error } = await getSupabaseAdmin().from("occasions").update({ is_active: isActive }).eq("id", id);

  if (error) {
    console.error("[toggleOccasionActive]", error.message);
    return { success: false, error: "Не удалось изменить статус повода" };
  }

  revalidatePath("/admin/occasions");
  revalidatePath("/catalog");
  return { success: true, data: null };
}

/**
 * Удаляет повод насовсем — и подчищает его у товаров.
 *
 * У поводов нет внешнего ключа: товар хранит повод строкой в
 * attributes.occasions и сверяется по имени. Если удалить только строку в
 * таблице occasions, у товаров останутся имена, которых больше нигде нет:
 * в фильтре каталога они не появятся, но в карточке товара в админке будут
 * висеть непонятными хвостами. Поэтому вторым шагом убираем имя из
 * attributes у всех товаров, где оно встречается.
 *
 * Порядок важен: сначала читаем товары (пока знаем имя), потом удаляем
 * строку. Если правка товаров сорвётся — повод останется на месте, и
 * состояние будет прежним, а не наполовину применённым.
 */
export async function deleteOccasion(id: string): Promise<ActionResult<null>> {
  await requireStaff();

  const supabaseAdmin = getSupabaseAdmin();

  const { data: occasion, error: readError } = await supabaseAdmin
    .from("occasions")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  if (readError || !occasion) {
    console.error("[deleteOccasion] повод не найден", readError?.message);
    return { success: false, error: "Повод не найден" };
  }

  const { data: productRows, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, attributes");

  if (productsError) {
    console.error("[deleteOccasion] чтение товаров", productsError.message);
    return { success: false, error: "Не удалось проверить товары" };
  }

  for (const row of productRows ?? []) {
    const attributes = (row.attributes ?? {}) as { occasions?: unknown };
    const names = attributes.occasions;
    if (!Array.isArray(names) || !names.includes(occasion.name)) continue;

    const { error: updateError } = await supabaseAdmin
      .from("products")
      .update({
        attributes: { ...attributes, occasions: names.filter((n) => n !== occasion.name) },
      })
      .eq("id", row.id);

    if (updateError) {
      console.error("[deleteOccasion] правка товара", row.id, updateError.message);
      return { success: false, error: "Не удалось убрать повод у товаров" };
    }
  }

  const { error: deleteError } = await supabaseAdmin.from("occasions").delete().eq("id", id);

  if (deleteError) {
    console.error("[deleteOccasion]", deleteError.message);
    return { success: false, error: "Не удалось удалить повод" };
  }

  revalidatePath("/admin/occasions");
  revalidatePath("/catalog");
  return { success: true, data: null };
}
