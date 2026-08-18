import { supabase } from "@/lib/supabase";

// ================================================================
// Поводы (occasions) — раньше был хардкод OCCASIONS в lib/products.ts,
// теперь таблица occasions (см. migrations/007_categories_occasions_admin.sql).
// Товары по-прежнему хранят повод как строку в products.attributes.occasions —
// сверяем по имени, отдельного id/slug на товаре нет.
// ================================================================

export type OccasionOption = {
  id: string;
  name: string;
};

/** Активные поводы для фильтра каталога и формы товара в админке. */
export async function getOccasions(): Promise<OccasionOption[]> {
  const { data, error } = await supabase
    .from("occasions")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getOccasions]", error.message);
    return [];
  }
  return data ?? [];
}
