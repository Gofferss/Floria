"use client";

import Link from "next/link";
import { useCart } from "@/components/cart/CartProvider";
import { CloseIcon, ArrowRightIcon } from "@/components/ui/Icons";
import { BotanicalPattern } from "@/components/ui/BotanicalPattern";

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export function CartDrawer() {
  const { items, subtotal, isDrawerOpen, closeDrawer, updateQuantity, removeItem } =
    useCart();

  return (
    <>
      {/* Затемнение фона */}
      <div
        className={`fixed inset-0 z-[60] bg-ink/40 transition-opacity ${
          isDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={closeDrawer}
        aria-hidden="true"
      />

      {/* Панель */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Корзина"
        className={`fixed right-0 top-0 z-[70] flex h-full w-full max-w-md flex-col bg-white shadow-xl transition-transform duration-300 ${
          isDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-lavender-100 px-5 py-4 sm:px-6">
          <h2 className="font-display text-lg font-semibold text-ink">
            Корзина{items.length > 0 ? ` (${items.length})` : ""}
          </h2>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Закрыть корзину"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink transition hover:bg-lavender-50"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="relative h-24 w-24 text-lavender-300">
              <BotanicalPattern className="h-full w-full" />
            </div>
            <p className="font-display text-base font-semibold text-ink">
              Корзина пока пуста
            </p>
            <p className="max-w-[240px] font-body text-sm text-ink/60">
              Загляните в каталог — соберём для вас букет по поводу или без.
            </p>
            <Link
              href="/catalog"
              onClick={closeDrawer}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-gold-500 px-6 py-3 font-display text-sm font-semibold text-white transition hover:bg-gold-600"
            >
              В каталог
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex gap-4 border-b border-lavender-100 py-4 first:pt-0 last:border-b-0"
                >
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-lavender-200 to-lavender-50">
                    <BotanicalPattern className="absolute inset-0 h-full w-full text-white/70" />
                  </div>

                  <div className="flex flex-1 flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-display text-sm font-semibold leading-snug text-ink">
                          {item.name}
                        </p>
                        <p className="mt-0.5 font-body text-xs text-ink/50">
                          Размер: {item.size}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={`Убрать «${item.name}» из корзины`}
                        className="shrink-0 text-ink/40 transition hover:text-ink"
                      >
                        <CloseIcon className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-auto flex items-center justify-between pt-2">
                      <div className="flex items-center rounded-full border border-lavender-200">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          aria-label="Уменьшить количество"
                          className="flex h-7 w-7 items-center justify-center font-display text-sm text-ink transition hover:text-gold-600"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-body text-sm text-ink">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          aria-label="Увеличить количество"
                          className="flex h-7 w-7 items-center justify-center font-display text-sm text-ink transition hover:text-gold-600"
                        >
                          +
                        </button>
                      </div>
                      <span className="font-display text-sm font-semibold text-ink">
                        {currency.format(item.price * item.quantity)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="border-t border-lavender-100 px-5 py-5 sm:px-6">
              <div className="flex items-center justify-between font-display text-base font-semibold text-ink">
                <span>Итого</span>
                <span>{currency.format(subtotal)}</span>
              </div>
              <p className="mt-1 font-body text-xs text-ink/50">
                Стоимость доставки рассчитается на шаге оформления заказа.
              </p>

              {/* Оформление заказа подключается к API на следующем этапе */}
              <Link
                href="/checkout"
                onClick={closeDrawer}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-gold-500 px-6 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-gold-600"
              >
                Оформить заказ
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
