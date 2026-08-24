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

/**
 * Активные НЕПУСТЫЕ категории — для главной страницы и фильтра каталога.
 *
 * Пустые отсеиваются сознательно: витрина не должна обещать раздел, в
 * котором ничего нет. Раньше на главной висели «Корзинки», «Свадебные
 * букеты» и «Сезонные букеты» без единого товара — посетитель нажимал и
 * попадал в никуда. Это же само собой решает и сезонные разделы: закончились
 * тюльпаны к 8 марта — категория ушла с витрины, завезли — вернулась.
 *
 * В админке (/admin/categories) видны ВСЕ категории, включая пустые, со
 * счётчиком товаров — там прятать нечего, там ими управляют.
 *
 * Два запроса вместо соединения: категорий и товаров единицы, а условие
 * «есть хотя бы один активный товар» через PostgREST-джойн выражается
 * заметно менее очевидно, чем пересечение множеств здесь.
 */
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

  const { data: productRows, error: productsError } = await supabase
    .from("products")
    .select("category_id")
    .eq("is_active", true)
    .not("category_id", "is", null);

  if (productsError) {
    // Не смогли выяснить наполнение — показываем всё, как раньше. Лишняя
    // пустая карточка не так плоха, как внезапно исчезнувшая витрина.
    console.error("[getCategories] наполнение категорий:", productsError.message);
    return (data as CategoryRow[]).map(mapRow);
  }

  const непустые = new Set((productRows ?? []).map((row) => row.category_id as string));

  return (data as CategoryRow[]).filter((row) => непустые.has(row.id)).map(mapRow);
}
