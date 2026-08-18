import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffUser } from "@/lib/auth/server";
import { getCatalogCategories, getProductForEdit } from "@/lib/actions/catalog";
import { ProductForm } from "@/components/admin/catalog/ProductForm";
import { ArrowRightIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Редактирование букета — Админка Floria",
};

type EditProductPageProps = {
  params: { id: string };
};

export default async function EditProductPage({ params }: EditProductPageProps) {
  await requireStaffUser();

  const [product, categories] = await Promise.all([
    getProductForEdit(params.id),
    getCatalogCategories(),
  ]);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <Link
          href="/admin/catalog"
          className="inline-flex items-center gap-1.5 font-body text-sm text-ink/50 transition hover:text-ink"
        >
          <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
          К каталогу
        </Link>

        <h1 className="mt-3 font-display text-2xl font-bold text-ink sm:text-3xl">{product.name}</h1>
      </div>

      <ProductForm categories={categories} product={product} />
    </div>
  );
}
