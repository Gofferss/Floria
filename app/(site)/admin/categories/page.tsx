import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { listCategoriesAdmin, deleteCategory } from "@/lib/actions/categories";
import { ArrowRightIcon, EditIcon } from "@/components/ui/Icons";
import { ToggleActiveButton } from "@/components/admin/categories/ToggleActiveButton";
import { DeleteButton } from "@/components/admin/DeleteButton";

export const metadata: Metadata = {
  title: "Категории — Админка Floria",
};

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  await requireStaffUser();
  const categories = await listCategoriesAdmin();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
            Админка
          </span>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Категории</h1>
        </div>

        <Link
          href="/admin/categories/new"
          className="flex items-center gap-2 rounded-full bg-gold-500 px-6 py-3.5 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600"
        >
          Добавить категорию
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-lavender-200 px-6 py-20 text-center">
          <p className="font-display text-lg font-semibold text-ink">Пока нет ни одной категории</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-lavender-100 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-lavender-100 bg-lavender-50/60">
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Название
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Статус
                  </th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr
                    key={category.id}
                    className="border-b border-lavender-50 transition last:border-0 hover:bg-lavender-50/50"
                  >
                    <td className="px-5 py-4">
                      <Link href={`/admin/categories/${category.id}/edit`} className="group block">
                        <span className="block font-display text-sm font-semibold text-ink transition group-hover:text-gold-600">
                          {category.name}
                        </span>
                        <span className="mt-0.5 block font-body text-xs text-ink/40">
                          /catalog?category={category.slug}
                          {" · "}
                          {category.productCount === 0
                            ? "нет товаров"
                            : `товаров: ${category.productCount}`}
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      {category.isActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 font-body text-xs font-medium text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                          Показана
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-lavender-100 px-3 py-1 font-body text-xs font-medium text-ink/60">
                          <span className="h-1.5 w-1.5 rounded-full bg-ink/30" aria-hidden="true" />
                          Скрыта
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <ToggleActiveButton categoryId={category.id} isActive={category.isActive} />
                        <Link
                          href={`/admin/categories/${category.id}/edit`}
                          aria-label="Редактировать категорию"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-100 hover:text-gold-600"
                        >
                          <EditIcon className="h-4 w-4" />
                        </Link>
                        <DeleteButton
                          iconOnly
                          what={`категорию «${category.name}»`}
                          consequence={
                            category.productCount > 0
                              ? `Товары не удалятся: ${category.productCount} шт. останутся без категории, их нужно будет разложить заново.`
                              : undefined
                          }
                          action={deleteCategory.bind(null, category.id)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
