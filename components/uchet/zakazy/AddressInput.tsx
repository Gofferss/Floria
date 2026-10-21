"use client";

import { useEffect, useRef, useState } from "react";
import { suggestAddress } from "@/lib/uchet/shop-order-actions";
import type { AddressSuggestion } from "@/lib/geo/dadata";
import { ui } from "@/components/uchet/ui";

/**
 * Адрес с подсказками DaData: начали печатать «Гоголя 7» — внизу «г
 * Симферополь, ул Гоголя, д 7». Выбранный адрес точно найдётся на карте,
 * и курьер не поедет на соседнюю улицу из-за опечатки. Без ключа DaData —
 * обычное поле: подсказок просто нет.
 */
export function AddressInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [hints, setHints] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const picked = useRef<string | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 3 || q === picked.current) {
      setHints([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const list = await suggestAddress(q).catch(() => []);
      if (!cancelled) {
        setHints(list);
        setOpen(true);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => hints.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        className={ui.field}
        placeholder="ул. Киевская, 41"
      />
      {open && hints.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white py-1 shadow-xl" role="listbox">
          {hints.map((h) => (
            <li key={h.value}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  picked.current = h.value;
                  onChange(h.value);
                  setOpen(false);
                  setHints([]);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-lavender-50"
              >
                {h.value}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
