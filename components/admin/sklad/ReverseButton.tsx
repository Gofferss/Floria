"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reverseDocument } from "@/lib/uchet/actions";

/**
 * Сторно — единственный способ исправить проведённый документ. Создаёт
 * новый документ с обратным знаком; исходный остаётся в журнале с
 * пометкой. Поэтому подтверждение обязательное, а причину лучше записать:
 * через месяц «почему сторнировали» уже никто не вспомнит.
 */
export function ReverseButton({ id, docNo }: { id: string; docNo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReverse() {
    setBusy(true);
    setError(null);
    const result = await reverseDocument(id, comment);
    setBusy(false);
    if (!result.success) return setError(result.error);
    router.push(`/admin/sklad/docs/${result.data.id}`);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-lavender-200 bg-white px-6 py-2.5 font-display text-sm font-semibold text-ink transition hover:border-red-300 hover:text-red-700"
      >
        Сторнировать
      </button>
    );
  }

  return (
    <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
      <p className="font-body text-sm text-red-900">
        Сторно {docNo}: будет создан документ с обратным знаком, и остатки вернутся как были. Сам {docNo} останется в
        журнале с пометкой.
      </p>
      <label htmlFor="reverse-comment" className="mt-4 block font-display text-xs font-semibold text-red-900/80">
        Почему — коротко
      </label>
      <input
        id="reverse-comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Например: ошиблись в количестве"
        className="mt-1 w-full rounded-xl border border-red-200 bg-white px-4 py-2.5 font-body text-sm text-ink outline-none focus:border-red-400"
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleReverse}
          disabled={busy}
          className="rounded-full bg-red-600 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Сторнируем…" : "Сторнировать"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-full border border-lavender-200 bg-white px-6 py-2.5 font-display text-sm font-semibold text-ink"
        >
          Отмена
        </button>
      </div>
      {error && <p className="mt-3 font-body text-sm text-red-700">{error}</p>}
    </div>
  );
}
