import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { AVAILABILITY_MODE_LABELS, type AvailabilityMode } from "@/lib/products";
import { ArrowRightIcon, EditIcon } from "@/components/ui/Icons";
import { ToggleActiveButton } from "@/components/admin/catalog/ToggleActiveButton";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { deleteProduct } from "@/lib/actions/catalog";

export const metadata: Metadata = {
  title: "Каталог — Админка Floria",
};

// Список должен сразу показывать только что сохранённый товар — без ISR.
export const dynamic = "force-dynamic";

type AdminProductRow = {
  id: string;
  name: string;
  slug: string;
  price: number;
  is_active: boolean;
  availability_mode: string | null;
  /** seed:/admin: — заведён у нас; всё остальное приходит из Posiflora. */
  posiflora_product_id: string | null;
  product_categories: { name: string } | { name: string }[] | null;
};

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function categoryName(row: AdminProductRow): string {
  const category = Array.isArray(row.product_categories) ? row.product_categories[0] : row.product_categories;
  return category?.name ?? "Без категории";
}

export default async function AdminCatalogListPage() {
  await requireStaffUser();

  const { data, error } = await getSupabaseAdmin()
    .from("products")
    .select("id, name, slug, price, is_active, availability_mode, posiflora_product_id, product_categories ( name )")
    .order("created_at", { ascending: false });

  if (error) console.error("[AdminCatalogListPage]", error.message);

  const products = (data ?? []) as unknown as AdminProductRow[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
            Админка
          </span>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Каталог букетов</h1>
        </div>

        <Link
          href="/admin/catalog/new"
          className="flex items-center gap-2 rounded-full bg-gold-500 px-6 py-3.5 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600"
        >
          Добавить букет
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-lavender-200 px-6 py-20 text-center">
          <p className="font-display text-lg font-semibold text-ink">Пока нет ни одного товара</p>
          <p className="mt-1 max-w-sm mx-auto font-body text-sm text-ink/50">
            Нажмите «Добавить букет», чтобы создать первую карточку вручную, или дождитесь синка с Posiflora.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-lavender-100 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-lavender-100 bg-lavender-50/60">
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Название
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Категория
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Цена
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Наличие
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Статус
                  </th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr
                    key={product.id}
                    className="border-b border-lavender-50 transition last:border-0 hover:bg-lavender-50/50"
                  >
                    <td className="px-5 py-4">
                      <Link href={`/admin/catalog/${product.id}/edit`} className="group block">
                        <span className="block font-display text-sm font-semibold text-ink transition group-hover:text-gold-600">
                          {product.name}
                        </span>
                        <span className="mt-0.5 block font-body text-xs text-ink/40">/catalog/{product.slug}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-4 font-body text-sm text-ink/60">{categoryName(product)}</td>
                    <td className="px-5 py-4 font-body text-sm text-ink/60">{currency.format(product.price)}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center rounded-full bg-lavender-100 px-3 py-1 font-body text-xs font-medium text-ink/70">
                        {AVAILABILITY_MODE_LABELS[(product.availability_mode as AvailabilityMode) ?? "in_stock"]}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {product.is_active ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 font-body text-xs font-medium text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                          В каталоге
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-lavender-100 px-3 py-1 font-body text-xs font-medium text-ink/60">
                          <span className="h-1.5 w-1.5 rounded-full bg-ink/30" aria-hidden="true" />
                          Скрыт
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <ToggleActiveButton productId={product.id} isActive={product.is_active} />
                        <Link
                          href={`/admin/catalog/${product.id}/edit`}
                          aria-label="Редактировать товар"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-100 hover:text-gold-600"
                        >
                          <EditIcon className="h-4 w-4" />
                        </Link>
                        <DeleteButton
                          iconOnly
                          what={`товар «${product.name}»`}
                          consequence={
                            // Товар из Posiflora синхронизация заведёт заново на
                            // следующем прогоне — предупреждаем, чтобы человек не
                            // удивлялся его возвращению и выбрал «Скрыть».
                            String(product.posiflora_product_id ?? "").match(/^(seed|admin):/)
                              ? "История заказов сохранится: в ней остаются название и цена на момент покупки."
                              : "Этот товар приходит из Посифлоры — синхронизация заведёт его заново. Чтобы убрать насовсем, лучше скрыть."
                          }
                          action={deleteProduct.bind(null, product.id)}
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
