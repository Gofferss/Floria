import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGallery } from "@/components/product/ProductGallery";
import { ProductPurchasePanel } from "@/components/product/ProductPurchasePanel";
import { ProductCard } from "@/components/catalog/ProductCard";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { getCategories } from "@/lib/categories";
import { getProductBySlug, getProductSlugs, getRelatedProducts } from "@/lib/products";

type ProductPageProps = {
  params: { slug: string };
};

// Каталог живой — перегенерируем страницу товара не чаще раза в минуту.
export const revalidate = 60;

export async function generateStaticParams() {
  const slugs = await getProductSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const product = await getProductBySlug(params.slug);
  if (!product) return {};
  return {
    title: `${product.name} — Floria`,
    description: product.description,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const product = await getProductBySlug(params.slug);
  if (!product) notFound();

  const [categories, relatedProducts] = await Promise.all([getCategories(), getRelatedProducts(product)]);
  const category = categories.find((c) => c.slug === product.categorySlug);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      {/* Хлебные крошки */}
      <nav className="mb-6 flex flex-wrap items-center gap-2 font-body text-sm text-ink/50">
        <Link href="/catalog" className="transition hover:text-gold-600">
          Каталог
        </Link>
        {category && (
          <>
            <span aria-hidden="true">/</span>
            <Link
              href={`/catalog?category=${category.slug}`}
              className="transition hover:text-gold-600"
            >
              {category.title}
            </Link>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span className="text-ink/80">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
        <ProductGallery images={product.images} productName={product.name} />

        <div>
          {category && (
            <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
              {category.title}
            </span>
          )}
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
            {product.name}
          </h1>
          <p className="mt-4 font-body text-base leading-relaxed text-ink/70">
            {product.description}
          </p>

          <div className="mt-8 border-t border-lavender-100 pt-8">
            <ProductPurchasePanel product={product} />
          </div>

          {/* Состав */}
          <div className="mt-8 border-t border-lavender-100 pt-8">
            <h2 className="font-display text-sm font-semibold text-ink">Состав букета</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {product.composition.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2.5 font-body text-sm text-ink/70"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Похожие товары */}
      {relatedProducts.length > 0 && (
        <section className="mt-16 border-t border-lavender-100 pt-12 lg:mt-24 lg:pt-16">
          <div className="mb-6 flex items-end justify-between">
            <h2 className="font-display text-2xl font-bold text-ink sm:text-3xl">
              Похожие букеты
            </h2>
            <Link
              href={`/catalog?category=${product.categorySlug}`}
              className="hidden items-center gap-1 font-display text-sm font-medium text-ink/70 transition hover:text-gold-600 sm:inline-flex"
            >
              Смотреть все
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3 lg:gap-6">
            {relatedProducts.map((related) => (
              <ProductCard key={related.id} product={related} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
