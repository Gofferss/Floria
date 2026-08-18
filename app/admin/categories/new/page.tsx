import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { listCategoriesAdmin } from "@/lib/actions/categories";
import { CategoryForm } from "@/components/admin/categories/CategoryForm";

export const metadata: Metadata = {
  title: "Новая категория — Админка Floria",
};

export default async function NewCategoryPage() {
  await requireStaffUser();
  const existing = await listCategoriesAdmin();
  const nextSortOrder = existing.length > 0 ? Math.max(...existing.map((c) => c.sortOrder)) + 10 : 10;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Категории
        </span>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Новая категория</h1>
      </div>

      <CategoryForm nextSortOrder={nextSortOrder} />
    </div>
  );
}
