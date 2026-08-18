"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteStory } from "@/lib/actions/stories";
import { CloseIcon } from "@/components/ui/Icons";

export function DeleteButton({ storyId, title }: { storyId: string; title: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm(`Удалить историю «${title}» вместе со всеми слайдами? Действие не отменить.`)) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteStory(storyId);
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
        aria-label="Удалить историю"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
      {error && (
        <p className="absolute right-0 top-full mt-1 whitespace-nowrap font-body text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
