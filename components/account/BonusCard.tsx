import { GiftIcon } from "@/components/ui/Icons";

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export function BonusCard({ balance }: { balance: number }) {
  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-6">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gold-500/10 text-gold-600">
          <GiftIcon className="h-4 w-4" />
        </span>
        <span className="font-display text-sm font-semibold text-ink">Бонусы</span>
      </div>

      <p className="mt-4 font-display text-4xl font-bold text-gold-600">
        {currency.format(balance)}
      </p>

      <p className="mt-2 font-body text-sm leading-relaxed text-ink/50">
        1 бонус = 1 ₽. Спишутся автоматически в корзине при следующем заказе.
      </p>
    </div>
  );
}
