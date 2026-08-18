import Link from "next/link";
import { BotanicalPattern } from "@/components/ui/BotanicalPattern";
import { ArrowRightIcon } from "@/components/ui/Icons";
import type { CheckoutItem } from "@/lib/checkout";

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

type OrderSummaryPanelProps = {
  items: CheckoutItem[];
  itemsTotal: number;
  deliveryPrice: number;
  bonusInput: string;
  onBonusInputChange: (value: string) => void;
  bonusApplied: number;
  availableBonus: number;
  total: number;
  onSubmit: () => void;
  isSubmitting: boolean;
  consentGiven: boolean;
  onConsentChange: (value: boolean) => void;
};

export function OrderSummaryPanel({
  items,
  itemsTotal,
  deliveryPrice,
  bonusInput,
  onBonusInputChange,
  bonusApplied,
  availableBonus,
  total,
  onSubmit,
  isSubmitting,
  consentGiven,
  onConsentChange,
}: OrderSummaryPanelProps) {
  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold text-ink">Ваш заказ</h2>

      <ul className="mt-4 flex flex-col gap-3">
        {items.map((item) => (
          <li key={`${item.productSlug}-${item.size}`} className="flex gap-3">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-lavender-200 to-lavender-50">
              <BotanicalPattern className="absolute inset-0 h-full w-full text-white/70" />
            </div>
            <div className="flex flex-1 items-start justify-between gap-2">
              <div>
                <p className="font-display text-sm font-medium leading-snug text-ink">
                  {item.name}
                </p>
                <p className="mt-0.5 font-body text-xs text-ink/50">
                  {item.size} · {item.quantity} шт
                </p>
              </div>
              <span className="shrink-0 font-body text-sm text-ink">
                {currency.format(item.price * item.quantity)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Бонусы */}
      <div className="mt-5 border-t border-lavender-100 pt-5">
        <label htmlFor="bonusInput" className="font-display text-sm font-medium text-ink">
          Списать бонусы
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="bonusInput"
            type="number"
            inputMode="numeric"
            min={0}
            max={availableBonus}
            value={bonusInput}
            onChange={(e) => onBonusInputChange(e.target.value)}
            placeholder="0"
            className="w-full rounded-xl border border-lavender-200 bg-lavender-50 px-4 py-2.5 font-body text-sm text-ink outline-none transition focus:border-gold-400 focus:bg-white focus:ring-2 focus:ring-gold-400/20"
          />
          <button
            type="button"
            onClick={() => onBonusInputChange(String(availableBonus))}
            className="shrink-0 rounded-xl border border-lavender-200 px-3 py-2.5 font-body text-xs font-medium text-ink/70 transition hover:border-gold-300"
          >
            Все
          </button>
        </div>
        <p className="mt-1.5 font-body text-xs text-ink/50">
          Доступно {availableBonus} бонусов · 1 бонус = 1 ₽
        </p>
      </div>

      {/* Суммы */}
      <div className="mt-5 flex flex-col gap-2 border-t border-lavender-100 pt-5 font-body text-sm">
        <div className="flex justify-between text-ink/70">
          <span>Товары</span>
          <span>{currency.format(itemsTotal)}</span>
        </div>
        <div className="flex justify-between text-ink/70">
          <span>Доставка</span>
          <span>{deliveryPrice === 0 ? "Бесплатно" : currency.format(deliveryPrice)}</span>
        </div>
        {bonusApplied > 0 && (
          <div className="flex justify-between text-gold-600">
            <span>Бонусы</span>
            <span>−{currency.format(bonusApplied)}</span>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-baseline justify-between border-t border-lavender-100 pt-4">
        <span className="font-display text-base font-semibold text-ink">Итого</span>
        <span className="font-display text-2xl font-bold text-ink">{currency.format(total)}</span>
      </div>

      <label className="mt-5 flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={consentGiven}
          onChange={(e) => onConsentChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-lavender-300 accent-gold-500"
        />
        <span className="font-body text-xs leading-relaxed text-ink/60">
          Согласен с{" "}
          <Link href="/consent" target="_blank" className="text-gold-600 underline underline-offset-2 hover:text-gold-700">
            обработкой персональных данных
          </Link>{" "}
          и условиями{" "}
          <Link href="/offer" target="_blank" className="text-gold-600 underline underline-offset-2 hover:text-gold-700">
            публичной оферты
          </Link>
        </span>
      </label>

      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting || !consentGiven}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-gold-500 px-6 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? "Оформляем..." : "Перейти к оплате"}
        {!isSubmitting && <ArrowRightIcon className="h-4 w-4" />}
      </button>

      <p className="mt-3 text-center font-body text-xs text-ink/40">
        Оплата картой, Т-Pay или через СБП на следующем шаге
      </p>
    </div>
  );
}
