"use client";

import Link from "next/link";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { CartIcon } from "@/components/ui/Icons";
import { useCart } from "@/components/cart/CartProvider";
import { trackEvent } from "@/lib/analytics/track";
import type { Product } from "@/lib/products";

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart();
  const defaultSize = product.sizes[0];
  const coverImage = product.images[0];

  function handleQuickAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    trackEvent("add_to_cart", product.name);
    addItem({
      id: `${product.slug}__${defaultSize.id}`,
      productSlug: product.slug,
      name: product.name,
      size: defaultSize.label,
      price: product.basePrice + defaultSize.priceModifier,
      image: coverImage,
    });
  }

  return (
    <Link
      href={`/catalog/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-3xl border border-lavender-100 bg-white transition hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-lavender-200 to-lavender-50">
        {coverImage ? (
          // Внешние URL из Supabase Storage — next/image потребовал бы
          // настройки remotePatterns, обычный img проще для карточек каталога
          <img
            src={coverImage}
            alt={product.name}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <PhotoPlaceholder className="absolute inset-0 h-full w-full" />
        )}

        <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {product.oldPrice && (
            <span className="rounded-full bg-gold-500 px-3 py-1 font-display text-xs font-semibold text-white">
              Скидка
            </span>
          )}
          {product.availabilityMode === "made_to_order" && (
            <span className="rounded-full bg-ink/70 px-3 py-1 font-display text-xs font-semibold text-white">
              Под заказ
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleQuickAdd}
          aria-label={`Быстро добавить «${product.name}» в корзину`}
          className="absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink opacity-0 shadow-sm transition group-hover:opacity-100 hover:bg-gold-500 hover:text-white"
        >
          <CartIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <h3 className="font-display text-sm font-semibold leading-snug text-ink sm:text-base">
          {product.name}
        </h3>

        <div className="mt-auto flex items-baseline gap-2 pt-3">
          <span className="font-display text-base font-semibold text-ink sm:text-lg">
            {currency.format(product.basePrice)}
            {product.pricingMode === "per_stem" && (
              // Без этой подписи «450 ₽» у поштучной срезки читалось бы как
              // цена целого букета — и покупатель удивился бы в корзине.
              <span className="font-body text-sm font-normal text-ink/50"> / шт</span>
            )}
          </span>
          {product.oldPrice && (
            <span className="font-body text-sm text-ink/40 line-through">
              {currency.format(product.oldPrice)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
