import { supabase } from "@/lib/supabase";

// ================================================================
// Категории каталога — читаем анонимным ключом из product_categories
// (см. migrations/001_setup_full_db.sql, 007_categories_occasions_admin.sql).
// RLS-политика public_read_active_categories отдаёт только активные записи.
// Запись — только через service-role (lib/actions/categories.ts) из
// /admin/categories, либо синк с Posiflora (lib/posiflora/catalog.ts).
// ================================================================

export type Category = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  image: string | null;
};

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  image_url: string | null;
};

function mapRow(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    title: row.name,
    subtitle: row.subtitle ?? "",
    image: row.image_url,
  };
}

/** Активные категории, отсортированные для главной страницы и фильтра каталога. */
export async function getCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, slug, name, subtitle, image_url")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getCategories]", error.message);
    return [];
  }
  return (data as CategoryRow[]).map(mapRow);
}
