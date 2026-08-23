"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon } from "@/components/ui/Icons";

type Props = {
  /** Что именно удаляем — попадёт в текст подтверждения: «Удалить категорию «Корзинки»?» */
  what: string;
  /**
   * Что произойдёт с связанными данными. Показывается отдельной строкой в
   * подтверждении, чтобы человек решал, зная последствия: товары останутся
   * без категории, история применений промокода будет стёрта и т.п.
   */
  consequence?: string;
  action: () => Promise<{ success: true; data: unknown } | { success: false; error: string }>;
  /** Компактный вариант — только иконка, для плотных списков. */
  iconOnly?: boolean;
};

/**
 * Кнопка окончательного удаления для админки.
 *
 * Скрытие (toggle-кнопки рядом) остаётся основным инструментом для всего
 * сезонного: скрыл «Тюльпаны к 8 марта» до весны — вернул. Удаление нужно
 * для другого: заведённого по ошибке, тестового, отменённого направления.
 * Поэтому кнопка красная, спрашивает подтверждение и честно называет
 * последствия для связанных данных.
 */
export function DeleteButton({ what, consequence, action, iconOnly = false }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    const question = `Удалить ${what}?`;
    const details = consequence ? `\n\n${consequence}` : "";
    if (!window.confirm(`${question}${details}\n\nДействие нельзя отменить.`)) return;

    setError(null);
    startTransition(async () => {
      const result = await action();
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
        aria-label={`Удалить ${what}`}
        title={`Удалить ${what}`}
        className={
          iconOnly
            ? "inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/40 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            : "inline-flex items-center gap-1.5 rounded-full border border-red-200 px-3 py-1.5 font-display text-xs font-semibold text-red-600 transition hover:border-red-400 hover:bg-red-50 disabled:opacity-50"
        }
      >
        <TrashIcon className="h-4 w-4" />
        {!iconOnly && (isPending ? "Удаляем…" : "Удалить")}
      </button>
      {error && (
        <p className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-lg bg-white px-2 py-1 font-body text-xs text-red-600 shadow">
          {error}
        </p>
      )}
    </div>
  );
}
