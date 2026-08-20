"use client";

import { useState } from "react";
import { updateCustomerName } from "@/lib/actions/account";
import { EditIcon, CheckIcon, CloseIcon } from "@/components/ui/Icons";

type EditableNameProps = {
  initialName: string;
};

export function EditableName({ initialName }: EditableNameProps) {
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Имя не может быть пустым");
      return;
    }

    setSaving(true);
    setError(null);

    const result = await updateCustomerName(trimmed);

    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setName(trimmed);
    setEditing(false);
  }

  function handleCancel() {
    setDraft(name);
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex items-center gap-2 text-left"
      >
        <span className="font-display text-lg font-semibold text-ink">
          {name || "Без имени"}
        </span>
        <EditIcon className="h-3.5 w-3.5 shrink-0 text-ink/30 transition group-hover:text-gold-600" />
      </button>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          autoFocus
          placeholder="Ваше имя"
          className="w-full rounded-xl border border-lavender-200 bg-lavender-50 px-3 py-2 font-display text-sm font-semibold text-ink outline-none transition focus:border-gold-400 focus:bg-white focus:ring-2 focus:ring-gold-400/20"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          aria-label="Сохранить имя"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-500 text-white transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <CheckIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={saving}
          aria-label="Отменить редактирование"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-50 hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      {error && <p className="mt-1.5 font-body text-xs text-red-600">{error}</p>}
    </div>
  );
}
