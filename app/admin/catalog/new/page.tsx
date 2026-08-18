import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { getCatalogCategories } from "@/lib/actions/catalog";
import { ProductForm } from "@/components/admin/catalog/ProductForm";

export const metadata: Metadata = {
  title: "Новый букет — Админка Floria",
};

export default async function NewProductPage() {
  await requireStaffUser();
  const categories = await getCatalogCategories();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Каталог
        </span>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Новый букет</h1>
      </div>

      <ProductForm categories={categories} />
    </div>
  );
}
