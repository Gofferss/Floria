"use client";

import { useEffect } from "react";

// ================================================================
// Цифровая клавиатура приложения. Своя, а не системная: системная на iPad
// закрывает пол-экрана вместе с чеком, а здесь кнопки крупные и видно, что
// набрано. С компьютера можно печатать с клавиатуры — цифры и Backspace.
// ================================================================

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"] as const;
const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** Сколько цифр максимум. */
  maxLength?: number;
  /** Режим PIN: без «00», и клавиатура не печатает в чужие поля. */
  pin?: boolean;
};

export function NumPad({ value, onChange, maxLength = 7, pin = false }: Props) {
  function press(key: string) {
    if (!key) return;
    if (key === "⌫") return onChange(value.slice(0, -1));
    const next = pin ? value + key : (value + key).replace(/^0+(?=\d)/, "");
    if (next.length <= maxLength) onChange(next);
  }

  // Физическая клавиатура — для компьютера владельца.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="grid grid-cols-3 gap-2">
      {(pin ? PIN_KEYS : KEYS).map((k, i) =>
        k ? (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            aria-label={k === "⌫" ? "Стереть" : k}
            className="h-14 rounded-xl bg-zinc-100 font-display text-xl font-semibold text-zinc-900 transition active:bg-zinc-200"
          >
            {k}
          </button>
        ) : (
          <span key={`gap-${i}`} aria-hidden="true" />
        )
      )}
    </div>
  );
}

/** Крупное табло суммы над клавиатурой: «2 500 ₽». */
export function AmountDisplay({ value }: { value: string }) {
  const n = Number(value || "0");
  return (
    <div className="flex h-16 items-center justify-end rounded-2xl bg-zinc-100 px-5 font-display text-3xl font-bold tabular-nums text-zinc-900">
      {n.toLocaleString("ru-RU")} ₽
    </div>
  );
}

export function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <div className="flex justify-center gap-3" aria-label={`Введено ${filled} из ${length}`}>
      {Array.from({ length }, (_, i) => (
        <span key={i} className={`h-3.5 w-3.5 rounded-full ${i < filled ? "bg-lavender-600" : "bg-zinc-200"}`} />
      ))}
    </div>
  );
}
