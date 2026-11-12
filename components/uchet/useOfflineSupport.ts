"use client";

import { useEffect } from "react";

// ================================================================
// Учёт без интернета: подключает помощника браузера (public/uchet-sw.js)
// и раз в час, пока связь есть, просит сохранить все разделы меню —
// чтобы без связи открывался и раздел, куда сегодня ещё не заходили.
// ================================================================

const WARM_KEY = "uchet.sw.warmedAt";
const WARM_EVERY_MS = 60 * 60 * 1000;
/** Не мешаем первой загрузке: прогрев — когда экран уже готов. */
const WARM_DELAY_MS = 10_000;

export function useOfflineSupport(urls: string[]) {
  const list = urls.join("|");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let stopped = false;
    let timer: number | undefined;

    const warm = async () => {
      if (stopped || !navigator.onLine) return;
      let last = 0;
      try {
        last = Number(localStorage.getItem(WARM_KEY)) || 0;
      } catch {
        // хранилище недоступно — прогреем, ничего страшного
      }
      if (Date.now() - last < WARM_EVERY_MS) return;
      const reg = await navigator.serviceWorker.ready;
      if (stopped || !reg.active) return;
      reg.active.postMessage({ type: "warm", urls: list.split("|").filter(Boolean) });
      try {
        localStorage.setItem(WARM_KEY, String(Date.now()));
      } catch {
        // не запомнили — прогреем снова позже, это только трафик
      }
    };
    const onOnline = () => void warm();

    navigator.serviceWorker
      .register("/uchet-sw.js", { scope: "/uchet" })
      .then(() => {
        if (stopped) return;
        timer = window.setTimeout(() => void warm(), WARM_DELAY_MS);
        window.addEventListener("online", onOnline);
      })
      .catch((e) => console.error("[uchet] помощник для работы без связи не подключился:", e));

    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [list]);
}

/** Стереть сохранённые копии экранов учёта (в них данные) — при выходе. Очередь продаж не трогаем. */
export async function forgetUchetPages(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    for (const key of await caches.keys()) {
      if (key.startsWith("uchet-pages-")) await caches.delete(key);
    }
  } catch {
    // нет доступа к хранилищу — выходим всё равно
  }
}
