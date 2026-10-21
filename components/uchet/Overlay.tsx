"use client";

import { useEffect } from "react";

// ================================================================
// Окна поверх экрана — три вида, как договорились в docs/uchet/ux.md:
//   * Panel  — справа: посмотреть и сделать мелкое, не уходя со списка;
//   * Sheet  — снизу на полэкрана: оплата, крупные кнопки под палец;
//   * Dialog — по центру: короткий вопрос, цифры, PIN.
// Закрываются по тёмному фону и Escape — кроме обязательных (dismissible
// = false), например «кто работает» на общем планшете.
// ================================================================

type Props = {
  label: string;
  onClose?: () => void;
  dismissible?: boolean;
  children: React.ReactNode;
};

function useEscape(onClose: (() => void) | undefined, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, enabled]);
}

function Backdrop({ onClose, dismissible }: { onClose?: () => void; dismissible: boolean }) {
  return dismissible && onClose ? (
    <button type="button" aria-label="Закрыть" onClick={onClose} className="absolute inset-0 bg-zinc-900/30" />
  ) : (
    <div className="absolute inset-0 bg-zinc-900/40" aria-hidden="true" />
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Закрыть"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900"
    >
      ✕
    </button>
  );
}

export function Panel({ label, onClose, dismissible = true, children }: Props) {
  useEscape(onClose, dismissible);
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={label}>
      <Backdrop onClose={onClose} dismissible={dismissible} />
      <aside className="relative flex h-full w-full max-w-[460px] flex-col overflow-y-auto bg-white shadow-2xl">{children}</aside>
    </div>
  );
}

export function Sheet({ label, onClose, dismissible = true, children }: Props) {
  useEscape(onClose, dismissible);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={label}>
      <Backdrop onClose={onClose} dismissible={dismissible} />
      <div
        className="relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:p-6"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {children}
      </div>
    </div>
  );
}

export function Dialog({ label, onClose, dismissible = true, children }: Props) {
  useEscape(onClose, dismissible);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={label}>
      <Backdrop onClose={onClose} dismissible={dismissible} />
      <div className="relative max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">{children}</div>
    </div>
  );
}
