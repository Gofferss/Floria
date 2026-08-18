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
};

export async function listOccasionsAdmin(): Promise<AdminOccasion[]> {
  await requireStaff();

  const { data, error } = await getSupabaseAdmin()
    .from("occasions")
    .select("id, name, sort_order, is_active")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[listOccasionsAdmin]", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active,
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
