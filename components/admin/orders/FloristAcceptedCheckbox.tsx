"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOrderFloristAccepted } from "@/lib/actions/orders";

export function FloristAcceptedCheckbox({ orderId, accepted }: { orderId: string; accepted: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setOrderFloristAccepted(orderId, next);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <label className="inline-flex items-center gap-2 cursor-pointer" title="Принят в обработку флористом">
      <input
        type="checkbox"
        checked={accepted}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.checked)}
        className="h-4 w-4 rounded border-lavender-300 accent-gold-500 disabled:opacity-50"
      />
      <span className="font-body text-xs text-ink/60">Принят в работу</span>
      {error && <span className="font-body text-xs text-red-600">{error}</span>}
    </label>
  );
}
