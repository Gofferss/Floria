import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog/CatalogView";
import { getCategories } from "@/lib/categories";
import { getOccasions } from "@/lib/occasions";
import { getPriceBounds, getProducts } from "@/lib/products";

export const metadata: Metadata = {
  title: "Каталог — Floria",
  description: "Авторские букеты, тюльпаны, свадебная флористика и цветочная подписка от студии Floria.",
};

// Каталог меняется вместе с остатками в Posiflora — перегенерируем
// страницу не чаще раза в минуту вместо запроса к БД на каждый заход.
export const revalidate = 60;

type CatalogPageProps = {
  searchParams: Promise<{ category?: string; q?: string }>;
};

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const [params, products, priceBounds, categories, occasions] = await Promise.all([
    searchParams,
    getProducts(),
    getPriceBounds(),
    getCategories(),
    getOccasions(),
  ]);

  return (
    <CatalogView
      products={products}
      categories={categories}
      occasions={occasions}
      priceBounds={priceBounds}
      initialCategorySlug={params.category}
      initialQuery={params.q}
    />
  );
}
