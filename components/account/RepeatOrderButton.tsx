"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { repeatOrder } from "@/lib/actions/repeat-order";
import { useCart } from "@/components/cart/CartProvider";

/**
 * Кладёт состав прошлого заказа в корзину и открывает её.
 *
 * Цены и наличие берутся сегодняшние — их определяет сервер, а не то, что
 * когда-то лежало в истории. Если какого-то букета в каталоге больше нет,
 * добавляем остальные и говорим, чего не хватило: молча «потерять» позицию
 * хуже, чем предупредить.
 */
export function RepeatOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { addItem, openDrawer } = useCart();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      const result = await repeatOrder(orderId);

      if (!result.success) {
        setError(result.error);
        return;
      }

      for (const item of result.items) {
        const { quantity, ...rest } = item;
        addItem(rest, quantity);
      }

      if (result.unavailable.length > 0) {
        setMessage(
          `Добавили в корзину. Сейчас нет в наличии: ${result.unavailable.join(", ")}.`
        );
      }

      openDrawer();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-full border border-lavender-200 px-4 py-2 font-display text-xs font-semibold text-ink transition hover:border-gold-400 hover:text-gold-700 disabled:opacity-50"
      >
        {isPending ? "Собираем…" : "Повторить заказ"}
      </button>
      {message && <p className="font-body text-xs text-ink/60">{message}</p>}
      {error && <p className="font-body text-xs text-red-600">{error}</p>}
    </div>
  );
}
