"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createOccasion,
  toggleOccasionActive,
  updateOccasion,
  type AdminOccasion,
} from "@/lib/actions/occasions";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon } from "@/components/ui/Icons";

function OccasionRow({ occasion }: { occasion: AdminOccasion }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(occasion.name);
  const [sortOrder, setSortOrder] = useState(String(occasion.sortOrder));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = name !== occasion.name || sortOrder !== String(occasion.sortOrder);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateOccasion(occasion.id, name, Number(sortOrder) || 0);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const result = await toggleOccasionActive(occasion.id, !occasion.isActive);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-lavender-50 px-5 py-4 last:border-0">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={`${inputClass()} w-52`}
      />
      <input
        type="number"
        value={sortOrder}
        onChange={(e) => setSortOrder(e.target.value)}
        className={`${inputClass()} w-24`}
        aria-label="Порядок"
      />

      {occasion.isActive ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 font-body text-xs font-medium text-green-700">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
          Показан
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-lavender-100 px-3 py-1 font-body text-xs font-medium text-ink/60">
          <span className="h-1.5 w-1.5 rounded-full bg-ink/30" aria-hidden="true" />
          Скрыт
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {saved && !dirty && <span className="font-body text-xs text-green-700">Сохранено</span>}
        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || !name.trim()}
            className="whitespace-nowrap rounded-full bg-gold-500 px-4 py-1.5 font-body text-xs font-semibold text-white transition hover:bg-gold-600 disabled:opacity-50"
          >
            Сохранить
          </button>
        )}
        <button
          type="button"
          onClick={handleToggle}
          disabled={isPending}
          className="whitespace-nowrap rounded-full border border-lavender-200 px-3 py-1.5 font-body text-xs font-medium text-ink/70 transition hover:border-gold-400 hover:text-gold-700 disabled:opacity-50"
        >
          {occasion.isActive ? "Скрыть" : "Показать"}
        </button>
      </div>

      {error && <p className="w-full font-body text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function OccasionsManager({ occasions }: { occasions: AdminOccasion[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nextSortOrder = occasions.length > 0 ? Math.max(...occasions.map((o) => o.sortOrder)) + 10 : 10;

  function handleAdd() {
    if (!newName.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createOccasion(newName, nextSortOrder);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setNewName("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Новый повод</h2>
        <p className="mt-1 font-body text-xs text-ink/50">
          Например: «Юбилей», «День матери» — появится в фильтре каталога и в форме товара
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="Название повода"
            className={`${inputClass()} max-w-xs`}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={isPending || !newName.trim()}
            className="flex items-center gap-2 rounded-full bg-gold-500 px-6 py-3 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
          >
            Добавить
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
        {error && <p className="mt-2 font-body text-xs text-red-600">{error}</p>}
      </div>

      {occasions.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-lavender-200 px-6 py-16 text-center">
          <p className="font-display text-base font-semibold text-ink">Поводов пока нет</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-lavender-100 bg-white">
          {occasions.map((occasion) => (
            <OccasionRow key={occasion.id} occasion={occasion} />
          ))}
        </div>
      )}
    </div>
  );
}
