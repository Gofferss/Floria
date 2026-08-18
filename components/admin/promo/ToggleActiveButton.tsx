"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { togglePromoCodeActive } from "@/lib/actions/promo-codes";

export function ToggleActiveButton({ promoCodeId, isActive }: { promoCodeId: string; isActive: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await togglePromoCodeActive(promoCodeId, !isActive);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="whitespace-nowrap rounded-full border border-lavender-200 px-3 py-1.5 font-body text-xs font-medium text-ink/70 transition hover:border-gold-400 hover:text-gold-700 disabled:opacity-50"
      >
        {isActive ? "Выключить" : "Включить"}
      </button>
      {error && (
        <p className="absolute right-0 top-full mt-1 whitespace-nowrap font-body text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
