"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CONTACTS } from "@/lib/contacts";
import { CloseIcon, PhoneIcon, TelegramIcon } from "@/components/ui/Icons";

// ================================================================
// «Сайт в разработке» — при заходе на сайт.
//
// Букеты на сайте можно смотреть и выбирать, но заказ пока надёжнее
// принять по телефону или в Telegram. Закрытое окно не показывается
// сутки, чтобы не мешать тому, кто уже прочитал. В админке не нужно.
// ================================================================

const STORAGE_KEY = "floria.devNotice.closedAt";
const HIDE_FOR_MS = 24 * 60 * 60 * 1000;

function closedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < HIDE_FOR_MS;
  } catch {
    return false;
  }
}

export function DevNoticePopup() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const firstButton = useRef<HTMLAnchorElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // Хранилище недоступно (приватный режим) — окно просто покажется снова при следующем заходе.
    }
  }, []);

  useEffect(() => {
    if (pathname?.startsWith("/admin")) return;
    if (closedRecently()) return;
    // Небольшая пауза: сначала человек видит сайт, потом окно.
    const t = setTimeout(() => setOpen(true), 700);
    return () => clearTimeout(t);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    firstButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center" onClick={close}>
      <div className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-notice-title"
        aria-describedby="dev-notice-text"
        className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Закрыть"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-50 hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
        </button>

        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">Флория</span>
        <h2 id="dev-notice-title" className="mt-2 pr-8 font-display text-2xl font-bold leading-tight text-ink">
          Сайт пока в разработке
        </h2>
        <p id="dev-notice-text" className="mt-3 font-body text-[15px] leading-relaxed text-ink/75">
          Букеты уже можно смотреть и выбирать. А заказать надёжнее по телефону или в Telegram: ответим, уточним
          детали и примем заказ.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <a
            ref={firstButton}
            href={`tel:${CONTACTS.phoneHref}`}
            className="flex items-center justify-center gap-2 rounded-full bg-gold-500 px-6 py-3.5 font-display text-sm font-semibold text-white shadow-sm transition hover:bg-gold-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2"
          >
            <PhoneIcon className="h-4 w-4" />
            {CONTACTS.phone}
          </a>
          <a
            href={CONTACTS.telegramChat}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-full border border-lavender-200 px-6 py-3.5 font-display text-sm font-semibold text-lavender-700 transition hover:border-lavender-300 hover:bg-lavender-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-lavender-300 focus-visible:ring-offset-2"
          >
            <TelegramIcon className="h-4 w-4" />
            Написать в Telegram
          </a>
          <button
            type="button"
            onClick={close}
            className="py-2 font-body text-sm text-ink/55 underline-offset-4 transition hover:text-ink hover:underline"
          >
            Смотреть букеты
          </button>
        </div>
      </div>
    </div>
  );
}
