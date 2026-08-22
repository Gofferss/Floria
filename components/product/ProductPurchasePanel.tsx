"use client";

import { useMemo, useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { CartIcon } from "@/components/ui/Icons";
import { trackEvent } from "@/lib/analytics/track";
import type { Product } from "@/lib/products";

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export function ProductPurchasePanel({ product }: { product: Product }) {
  const { addItem, openDrawer } = useCart();
  const [sizeId, setSizeId] = useState(product.sizes[0].id);
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  const selectedSize = useMemo(
    () => product.sizes.find((s) => s.id === sizeId) ?? product.sizes[0],
    [product.sizes, sizeId]
  );

  const unitPrice = product.basePrice + selectedSize.priceModifier;

  function handleAddToCart() {
    trackEvent("add_to_cart", product.name);
    addItem(
      {
        id: `${product.slug}__${selectedSize.id}`,
        productSlug: product.slug,
        name: product.name,
        size: selectedSize.label,
        price: unitPrice,
        image: product.images[0],
        availabilityMode: product.availabilityMode,
      },
      quantity
    );
    setJustAdded(true);
    openDrawer();
    window.setTimeout(() => setJustAdded(false), 1500);
  }

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="font-display text-3xl font-bold text-ink">
          {currency.format(unitPrice)}
        </span>
        {product.oldPrice && (
          <span className="font-body text-lg text-ink/40 line-through">
            {currency.format(product.oldPrice)}
          </span>
        )}
      </div>

      {/* Размер */}
      {product.sizes.length > 1 && (
        <div className="mt-6">
          <span className="font-display text-sm font-semibold text-ink">Размер</span>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {product.sizes.map((size) => {
              const active = size.id === sizeId;
              return (
                <button
                  key={size.id}
                  type="button"
                  onClick={() => setSizeId(size.id)}
                  className={`min-w-[52px] rounded-xl border px-4 py-2.5 font-display text-sm font-medium transition ${
                    active
                      ? "border-gold-500 bg-gold-500 text-white"
                      : "border-lavender-200 bg-white text-ink/70 hover:border-gold-300"
                  }`}
                >
                  {size.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Количество + кнопка */}
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center justify-between rounded-full border border-lavender-200 px-2 py-1.5 sm:w-32 sm:justify-center sm:gap-4">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            aria-label="Уменьшить количество"
            className="flex h-8 w-8 items-center justify-center font-display text-base text-ink transition hover:text-gold-600"
          >
            −
          </button>
          <span className="font-body text-sm text-ink">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => q + 1)}
            aria-label="Увеличить количество"
            className="flex h-8 w-8 items-center justify-center font-display text-base text-ink transition hover:text-gold-600"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={handleAddToCart}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600"
        >
          <CartIcon className="h-4 w-4" />
          {justAdded ? "Добавлено" : "В корзину"}
        </button>
      </div>

      <p className="mt-4 font-body text-xs text-ink/50">
        Доставка сегодня при заказе до 18:00. Точную дату и время укажете при оформлении.
      </p>
    </div>
  );
}
