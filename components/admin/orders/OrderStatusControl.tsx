"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrderStatus, type OrderStatus } from "@/lib/actions/orders";

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: "new", label: "Новый" },
  { value: "confirmed", label: "Подтверждён" },
  { value: "assembling", label: "Собирается" },
  { value: "ready", label: "Готов к отправке" },
  { value: "delivering", label: "В доставке" },
  { value: "completed", label: "Доставлен" },
  { value: "cancelled", label: "Отменён" },
];

export function OrderStatusControl({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(next: OrderStatus) {
    if (next === status) return;
    setError(null);
    startTransition(async () => {
      const result = await updateOrderStatus(orderId, next);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <select
        value={status}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value as OrderStatus)}
        className="rounded-full border border-lavender-200 bg-white px-4 py-2 font-display text-sm font-medium text-ink transition hover:border-gold-400 disabled:opacity-50"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 font-body text-xs text-red-600">{error}</p>}
    </div>
  );
}
