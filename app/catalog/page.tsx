import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog/CatalogView";
import { categories } from "@/lib/mock-data";
import { getPriceBounds, getProducts } from "@/lib/products";

export const metadata: Metadata = {
  title: "Каталог — Floria",
  description: "Авторские букеты, тюльпаны, свадебная флористика и цветочная подписка от студии Floria.",
};

// Каталог меняется вместе с остатками в Posiflora — перегенерируем
// страницу не чаще раза в минуту вместо запроса к БД на каждый заход.
export const revalidate = 60;

type CatalogPageProps = {
  searchParams: { category?: string };
};

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const [products, priceBounds] = await Promise.all([getProducts(), getPriceBounds()]);

  return (
    <CatalogView
      products={products}
      categories={categories}
      priceBounds={priceBounds}
      initialCategorySlug={searchParams.category}
    />
  );
}
