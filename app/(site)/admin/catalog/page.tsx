import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { AVAILABILITY_MODE_LABELS, type AvailabilityMode } from "@/lib/products";
import { ArrowRightIcon, EditIcon } from "@/components/ui/Icons";
import { ToggleActiveButton } from "@/components/admin/catalog/ToggleActiveButton";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { deleteProduct } from "@/lib/actions/catalog";
import { isInSeason, seasonSummary } from "@/lib/season";

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
  season_months: number[] | null;
  nickname: string | null;
  images: string[] | null;
  /** seed:/admin: — заведён у нас; всё остальное приходит из Posiflora. */
  posiflora_product_id: string | null;
  product_categories: { name: string; slug: string } | { name: string; slug: string }[] | null;
};

// Разделы списка. «В наличии» и «Под заказ» — среди тех, что не скрыты:
// скрытые собраны в своём разделе, чтобы не путались с видимыми.
const VIEWS = [
  { id: "all", label: "Все" },
  { id: "site", label: "На сайте" },
  { id: "in_stock", label: "В наличии" },
  { id: "made_to_order", label: "Под заказ" },
  { id: "season", label: "Не сезон" },
  { id: "hidden", label: "Скрытые" },
  { id: "no_photo", label: "Без фото" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

function inView(row: AdminProductRow, view: ViewId): boolean {
  const inSeason = isInSeason(row.season_months);
  const mode = row.availability_mode === "made_to_order" ? "made_to_order" : "in_stock";
  switch (view) {
    case "all":
      return true;
    case "site":
      return row.is_active && inSeason;
    case "in_stock":
    case "made_to_order":
      return row.is_active && mode === view;
    case "season":
      return row.is_active && !inSeason;
    case "hidden":
      return !row.is_active;
    case "no_photo":
      return !row.images?.[0];
  }
}

/** Нижний регистр, «ё» → «е», без кавычек — как в поиске на сайте. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/[«»"'.,!?;:()—–-]+/g, " ").replace(/\s+/g, " ").trim();
}

function categoryOf(row: AdminProductRow): { name: string; slug: string } | null {
  return (Array.isArray(row.product_categories) ? row.product_categories[0] : row.product_categories) ?? null;
}

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function categoryName(row: AdminProductRow): string {
  return categoryOf(row)?.name ?? "Без категории";
}

type SearchParams = { view?: string; cat?: string; q?: string };

export default async function AdminCatalogListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaffUser();
  const params = await searchParams;

  const { data, error } = await getSupabaseAdmin()
    .from("products")
    .select("id, name, slug, price, is_active, availability_mode, season_months, nickname, images, posiflora_product_id, product_categories ( name, slug )")
    .order("created_at", { ascending: false });

  if (error) console.error("[AdminCatalogListPage]", error.message);

  const allProducts = (data ?? []) as unknown as AdminProductRow[];

  const view: ViewId = VIEWS.some((v) => v.id === params.view) ? (params.view as ViewId) : "all";
  const categories = [...new Map(allProducts.map((p) => categoryOf(p)).filter((c): c is { name: string; slug: string } => !!c).map((c) => [c.slug, c])).values()];
  const cat = categories.some((c) => c.slug === params.cat) ? params.cat! : "";
  const query = (params.q ?? "").slice(0, 100);
  const words = normalize(query).split(" ").filter(Boolean);

  // Счётчики разделов — с учётом выбранной категории и поиска, чтобы цифра
  // совпадала с тем, что откроется по нажатию.
  const matchesCatAndQuery = (p: AdminProductRow) =>
    (!cat || categoryOf(p)?.slug === cat) &&
    (words.length === 0 || words.every((w) => normalize(`${p.name} ${p.nickname ?? ""} ${p.slug}`).includes(w)));
  const narrowed = allProducts.filter(matchesCatAndQuery);
  const counts = Object.fromEntries(VIEWS.map((v) => [v.id, narrowed.filter((p) => inView(p, v.id)).length])) as Record<ViewId, number>;
  const products = narrowed.filter((p) => inView(p, view));

  const href = (next: Partial<SearchParams>) => {
    const merged = { view: view === "all" ? "" : view, cat, q: query, ...next };
    const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
    return qs ? `/admin/catalog?${qs}` : "/admin/catalog";
  };
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-body text-sm transition ${
      active ? "bg-lavender-600 text-white" : "bg-white text-ink/70 ring-1 ring-lavender-100 hover:bg-lavender-50"
    }`;

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

      {allProducts.length > 0 && (
        <div className="mb-6 flex flex-col gap-3">
          <nav aria-label="Разделы каталога" className="flex flex-wrap gap-2">
            {VIEWS.map((v) => (
              <Link key={v.id} href={href({ view: v.id === "all" ? "" : v.id })} className={chip(view === v.id)} aria-current={view === v.id ? "page" : undefined}>
                {v.label}
                <span className={view === v.id ? "text-white/75" : "text-ink/40"}>{counts[v.id]}</span>
              </Link>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href({ cat: "" })} className={chip(!cat)}>Все категории</Link>
            {categories.map((c) => (
              <Link key={c.slug} href={href({ cat: c.slug })} className={chip(cat === c.slug)}>{c.name}</Link>
            ))}
            {/* Поиск — обычная форма: работает и без скриптов, а раздел и категория едут скрытыми полями. */}
            <form action="/admin/catalog" className="ml-auto flex min-w-0 flex-1 basis-56 gap-2">
              {view !== "all" && <input type="hidden" name="view" value={view} />}
              {cat && <input type="hidden" name="cat" value={cat} />}
              <input
                id="admin-catalog-q"
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Название, маленькое название или адрес"
                aria-label="Поиск по каталогу"
                className="min-w-0 flex-1 rounded-full border border-lavender-100 bg-white px-4 py-2 font-body text-sm text-ink placeholder:text-ink/35 focus:border-lavender-300 focus:outline-none"
              />
              <button type="submit" className="rounded-full bg-lavender-600 px-4 py-2 font-body text-sm text-white transition hover:bg-lavender-700">
                Найти
              </button>
            </form>
          </div>
          <p className="font-body text-xs text-ink/45">
            Показано {products.length} из {allProducts.length}
            {(view !== "all" || cat || query) && (
              <>
                {" · "}
                <Link href="/admin/catalog" className="underline underline-offset-2 hover:text-gold-600">сбросить</Link>
              </>
            )}
          </p>
        </div>
      )}

      {allProducts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-lavender-200 px-6 py-20 text-center">
          <p className="font-display text-lg font-semibold text-ink">Пока нет ни одного товара</p>
          <p className="mt-1 max-w-sm mx-auto font-body text-sm text-ink/50">
            Нажмите «Добавить букет», чтобы создать первую карточку вручную, или дождитесь синка с Posiflora.
          </p>
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-lavender-200 px-6 py-16 text-center">
          <p className="font-display text-lg font-semibold text-ink">Здесь букетов нет</p>
          <p className="mt-1 font-body text-sm text-ink/50">
            Выберите другой раздел или <Link href="/admin/catalog" className="underline underline-offset-2">сбросьте фильтры</Link>.
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
                      <Link href={`/admin/catalog/${product.id}/edit`} className="group flex items-center gap-3">
                        {/* Миниатюра — чтобы узнавать букет глазами, а не по названию. */}
                        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-lavender-50 ring-1 ring-lavender-100">
                          {product.images?.[0] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.images[0]} alt="" loading="lazy" className="h-full w-full object-cover" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-display text-sm font-semibold text-ink transition group-hover:text-gold-600">
                            {product.name}
                          </span>
                          {product.nickname && <span className="block font-body text-xs text-ink/55">«{product.nickname}»</span>}
                          <span className="mt-0.5 block font-body text-xs text-ink/40">/catalog/{product.slug}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-4 font-body text-sm text-ink/60">{categoryName(product)}</td>
                    <td className="px-5 py-4 font-body text-sm text-ink/60">{currency.format(product.price)}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center rounded-full bg-lavender-100 px-3 py-1 font-body text-xs font-medium text-ink/70">
                        {AVAILABILITY_MODE_LABELS[(product.availability_mode as AvailabilityMode) ?? "in_stock"]}
                      </span>
                      {product.season_months && (
                        <span className="mt-1 block font-body text-xs text-ink/50">{seasonSummary(product.season_months)}</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {product.is_active && !isInSeason(product.season_months) ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-500/10 px-3 py-1 font-body text-xs font-medium text-gold-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-gold-500" aria-hidden="true" />
                          Не сезон
                        </span>
                      ) : product.is_active ? (
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
