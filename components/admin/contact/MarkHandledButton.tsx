"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markContactHandled } from "@/lib/actions/contact-requests";

/**
 * Отметка «связались». Подтверждения намеренно НЕТ: действие безобидное
 * и обратимое по смыслу (перезвонить ещё раз никто не мешает), а лишний
 * вопрос на каждое обращение только раздражает.
 */
export function MarkHandledButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await markContactHandled(id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-full border border-lavender-200 px-4 py-2 font-display text-xs font-semibold text-ink transition hover:border-gold-400 hover:text-gold-700 disabled:opacity-50"
      >
        {isPending ? "Отмечаю…" : "Связались"}
      </button>
      {error && <p className="font-body text-xs text-red-600">{error}</p>}
    </div>
  );
}
