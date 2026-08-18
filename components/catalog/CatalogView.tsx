"use client";

import { useEffect, useMemo, useState } from "react";
import { FilterPanel } from "@/components/catalog/FilterPanel";
import { ProductCard } from "@/components/catalog/ProductCard";
import { CloseIcon } from "@/components/ui/Icons";
import type { Category } from "@/lib/categories";
import type { OccasionOption } from "@/lib/occasions";
import type { Product, Occasion, AvailabilityMode } from "@/lib/products";

type CatalogViewProps = {
  products: Product[];
  categories: Category[];
  occasions: OccasionOption[];
  /** Границы цен считаются на сервере — из клиента к БД не ходим */
  priceBounds: { min: number; max: number };
  initialCategorySlug?: string;
  initialQuery?: string;
};

export function CatalogView({
  products,
  categories,
  occasions,
  priceBounds,
  initialCategorySlug,
  initialQuery,
}: CatalogViewProps) {

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set(initialCategorySlug ? [initialCategorySlug] : [])
  );
  const [selectedOccasions, setSelectedOccasions] = useState<Set<Occasion>>(new Set());
  const [selectedAvailability, setSelectedAvailability] = useState<Set<AvailabilityMode>>(new Set());
  const [searchQuery, setSearchQuery] = useState(initialQuery ?? "");

  // /catalog и /catalog?category=... — один и тот же роут, поэтому переход
  // между пунктами меню "Букеты"/"Свадьба" не размонтирует CatalogView и не
  // перезапускает useState-инициализатор выше — без этого эффекта фильтр
  // молча оставался тем, каким был при первом заходе на страницу. Та же
  // причина — для поиска из шапки (?q=...).
  useEffect(() => {
    setSelectedCategories(new Set(initialCategorySlug ? [initialCategorySlug] : []));
  }, [initialCategorySlug]);

  useEffect(() => {
    setSearchQuery(initialQuery ?? "");
  }, [initialQuery]);

  const [priceFrom, setPriceFrom] = useState("");
  const [priceTo, setPriceTo] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  function toggleCategory(slug: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  }

  function toggleOccasion(occasion: Occasion) {
    setSelectedOccasions((prev) => {
      const next = new Set(prev);
      next.has(occasion) ? next.delete(occasion) : next.add(occasion);
      return next;
    });
  }

  function toggleAvailability(mode: AvailabilityMode) {
    setSelectedAvailability((prev) => {
      const next = new Set(prev);
      next.has(mode) ? next.delete(mode) : next.add(mode);
      return next;
    });
  }

  function resetFilters() {
    setSelectedCategories(new Set());
    setSelectedOccasions(new Set());
    setSelectedAvailability(new Set());
    setSearchQuery("");
    setPriceFrom("");
    setPriceTo("");
  }

  const filteredProducts = useMemo(() => {
    const from = priceFrom ? Number(priceFrom) : null;
    const to = priceTo ? Number(priceTo) : null;
    const query = searchQuery.trim().toLowerCase();

    return products.filter((product) => {
      if (selectedCategories.size > 0 && !selectedCategories.has(product.categorySlug)) {
        return false;
      }
      if (
        selectedOccasions.size > 0 &&
        !product.occasions.some((o) => selectedOccasions.has(o))
      ) {
        return false;
      }
      if (selectedAvailability.size > 0 && !selectedAvailability.has(product.availabilityMode)) {
        return false;
      }
      if (from !== null && product.basePrice < from) return false;
      if (to !== null && product.basePrice > to) return false;
      if (query) {
        // Ищем по названию и составу — по названию мало кто вспомнит
        // точно, а вот "розы" или "тюльпаны" в составе введут почти все.
        const matchesName = product.name.toLowerCase().includes(query);
        const matchesComposition = product.composition.some((line) =>
          line.toLowerCase().includes(query)
        );
        const matchesDescription = product.description.toLowerCase().includes(query);
        if (!matchesName && !matchesComposition && !matchesDescription) return false;
      }
      return true;
    });
  }, [
    products,
    selectedCategories,
    selectedOccasions,
    selectedAvailability,
    searchQuery,
    priceFrom,
    priceTo,
  ]);

  const filterProps = {
    categories,
    occasions,
    selectedCategories,
    onToggleCategory: toggleCategory,
    selectedOccasions,
    onToggleOccasion: toggleOccasion,
    selectedAvailability,
    onToggleAvailability: toggleAvailability,
    priceFrom,
    priceTo,
    onPriceFromChange: setPriceFrom,
    onPriceToChange: setPriceTo,
    onReset: resetFilters,
    priceBounds,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
            Каталог
          </span>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">
            Букеты и подарки
          </h1>
          {searchQuery.trim() && (
            <p className="mt-2 font-body text-sm text-ink/50">
              Результаты по запросу «{searchQuery.trim()}» —{" "}
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-gold-600 underline underline-offset-4"
              >
                очистить
              </button>
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileFiltersOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-lavender-200 bg-white px-5 py-2.5 font-display text-sm font-medium text-ink lg:hidden"
        >
          Фильтры
          {(selectedCategories.size > 0 ||
            selectedOccasions.size > 0 ||
            selectedAvailability.size > 0 ||
            priceFrom ||
            priceTo) && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold-500 text-[11px] font-semibold text-white">
              {selectedCategories.size +
                selectedOccasions.size +
                selectedAvailability.size +
                (priceFrom ? 1 : 0) +
                (priceTo ? 1 : 0)}
            </span>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr] lg:gap-12">
        {/* Сайдбар — десктоп */}
        <aside className="hidden lg:block">
          <div className="sticky top-28">
            <FilterPanel {...filterProps} />
          </div>
        </aside>

        {/* Сетка товаров */}
        <div>
          <p className="mb-5 font-body text-sm text-ink/50">
            {filteredProducts.length}{" "}
            {pluralizeProducts(filteredProducts.length)}
          </p>

          {filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-lavender-200 py-20 text-center">
              <p className="font-display text-base font-semibold text-ink">
                По этим фильтрам ничего не нашлось
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="font-body text-sm text-gold-600 underline underline-offset-4"
              >
                Сбросить фильтры
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3 lg:gap-6">
              {filteredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Мобильная шторка фильтров */}
      <div
        className={`fixed inset-0 z-[60] bg-ink/40 transition-opacity lg:hidden ${
          mobileFiltersOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMobileFiltersOpen(false)}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Фильтры"
        className={`fixed left-0 top-0 z-[70] h-full w-full max-w-sm overflow-y-auto bg-white p-6 shadow-xl transition-transform duration-300 lg:hidden ${
          mobileFiltersOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between">
          <span className="font-display text-lg font-semibold text-ink">Фильтры</span>
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(false)}
            aria-label="Закрыть фильтры"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink transition hover:bg-lavender-50"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <FilterPanel {...filterProps} />
        <button
          type="button"
          onClick={() => setMobileFiltersOpen(false)}
          className="mt-8 w-full rounded-full bg-gold-500 px-6 py-3.5 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-gold-600"
        >
          Показать {filteredProducts.length}
        </button>
      </aside>
    </div>
  );
}

function pluralizeProducts(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "товар";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "товара";
  return "товаров";
}
