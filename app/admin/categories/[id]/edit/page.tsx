import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffUser } from "@/lib/auth/server";
import { getCategoryForEdit } from "@/lib/actions/categories";
import { CategoryForm } from "@/components/admin/categories/CategoryForm";
import { ArrowRightIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Редактирование категории — Админка Floria",
};

type EditCategoryPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCategoryPage({ params }: EditCategoryPageProps) {
  await requireStaffUser();

  const { id } = await params;
  const category = await getCategoryForEdit(id);
  if (!category) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <Link
          href="/admin/categories"
          className="inline-flex items-center gap-1.5 font-body text-sm text-ink/50 transition hover:text-ink"
        >
          <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
          К категориям
        </Link>

        <h1 className="mt-3 font-display text-2xl font-bold text-ink sm:text-3xl">{category.name}</h1>
      </div>

      <CategoryForm category={category} />
    </div>
  );
}
