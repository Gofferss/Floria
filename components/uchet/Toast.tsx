"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Toast = { id: number; text: string; tone: "ok" | "error"; action?: { label: string; run: () => void } };

const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});

/**
 * Короткие сообщения внизу экрана: «СП-0004 проведён · Отменить».
 *
 * Вместо подтверждений на каждый чих — действие сразу и шесть секунд на
 * передумать. Так быстрее, а ошибка всё равно исправима.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, toast.action ? 6000 : 3500);
    return () => clearTimeout(id);
  }, [toast, onDone]);

  return (
    <div
      className={`pointer-events-auto flex max-w-md items-center gap-4 rounded-xl px-4 py-3 text-sm shadow-lg ${
        toast.tone === "error" ? "bg-red-600 text-white" : "bg-zinc-900 text-white"
      }`}
      role={toast.tone === "error" ? "alert" : "status"}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            onDone();
          }}
          className="shrink-0 font-semibold text-gold-300 underline-offset-4 hover:underline"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
