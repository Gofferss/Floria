import type { Category } from "@/lib/categories";
import type { AvailabilityMode } from "@/lib/products";
import { AVAILABILITY_MODES, AVAILABILITY_MODE_LABELS } from "@/lib/products";

type FilterPanelProps = {
  categories: Category[];
  selectedCategories: Set<string>;
  onToggleCategory: (slug: string) => void;
  selectedAvailability: Set<AvailabilityMode>;
  onToggleAvailability: (mode: AvailabilityMode) => void;
  priceFrom: string;
  priceTo: string;
  onPriceFromChange: (value: string) => void;
  onPriceToChange: (value: string) => void;
  onReset: () => void;
  priceBounds: { min: number; max: number };
};

export function FilterPanel({
  categories,
  selectedCategories,
  onToggleCategory,
  selectedAvailability,
  onToggleAvailability,
  priceFrom,
  priceTo,
  onPriceFromChange,
  onPriceToChange,
  onReset,
  priceBounds,
}: FilterPanelProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-ink">Фильтры</h2>
        <button
          type="button"
          onClick={onReset}
          className="font-body text-sm text-ink/50 underline decoration-lavender-300 underline-offset-4 transition hover:text-gold-600"
        >
          Сбросить
        </button>
      </div>

      {/* Категории */}
      <fieldset>
        <legend className="font-display text-sm font-semibold text-ink">Категория</legend>
        <div className="mt-3 flex flex-col gap-2.5">
          {categories.map((category) => (
            <label
              key={category.slug}
              className="flex cursor-pointer items-center gap-2.5 font-body text-sm text-ink/80"
            >
              <input
                type="checkbox"
                checked={selectedCategories.has(category.slug)}
                onChange={() => onToggleCategory(category.slug)}
                className="h-4 w-4 rounded border-lavender-300 text-gold-500 accent-gold-500 focus:ring-gold-400/40"
              />
              {category.title}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Наличие */}
      <fieldset>
        <legend className="font-display text-sm font-semibold text-ink">Наличие</legend>
        <div className="mt-3 flex flex-col gap-2.5">
          {AVAILABILITY_MODES.map((mode) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center gap-2.5 font-body text-sm text-ink/80"
            >
              <input
                type="checkbox"
                checked={selectedAvailability.has(mode)}
                onChange={() => onToggleAvailability(mode)}
                className="h-4 w-4 rounded border-lavender-300 text-gold-500 accent-gold-500 focus:ring-gold-400/40"
              />
              {AVAILABILITY_MODE_LABELS[mode]}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Цена */}
      <fieldset>
        <legend className="font-display text-sm font-semibold text-ink">Цена, ₽</legend>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="number"
            inputMode="numeric"
            placeholder={String(priceBounds.min)}
            value={priceFrom}
            onChange={(e) => onPriceFromChange(e.target.value)}
            className="w-full rounded-xl border border-lavender-200 bg-lavender-50 px-3 py-2 font-body text-sm text-ink outline-none focus:border-gold-400 focus:bg-white focus:ring-2 focus:ring-gold-400/20"
          />
          <span className="text-ink/30">—</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder={String(priceBounds.max)}
            value={priceTo}
            onChange={(e) => onPriceToChange(e.target.value)}
            className="w-full rounded-xl border border-lavender-200 bg-lavender-50 px-3 py-2 font-body text-sm text-ink outline-none focus:border-gold-400 focus:bg-white focus:ring-2 focus:ring-gold-400/20"
          />
        </div>
      </fieldset>

    </div>
  );
}
