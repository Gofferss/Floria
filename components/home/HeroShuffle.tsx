"use client";

import { useLayoutEffect, useRef } from "react";

// ================================================================
// Какие букеты показать в окнах главного блока — решает браузер.
//
// В каждом окне ([data-hero-slot]) сервер кладёт несколько букетов
// ([data-hero-photo]), видим только первый — его и увидит тот, у кого
// скрипты не работают. Скрипт открывает в каждом окне случайный, причём
// по возможности не тот, что был в прошлый раз (помним в localStorage).
//
// Выбирать нужно до того, как страница появится на экране, иначе букеты
// будут на глазах сменяться. Поэтому при обычном заходе выбор делает
// встроенный скрипт прямо в разметке: он выполняется, пока браузер её
// читает, ещё до первой отрисовки и задолго до загрузки React. При
// переходе на главную внутри сайта такие скрипты не выполняются — тогда
// то же самое делает useLayoutEffect, тоже до отрисовки.
//
// Скрытые букеты фото не грузят: картинки ленивые, а у скрытого окна нет
// места на экране, так что браузер их не запрашивает.
// ================================================================

/**
 * Выполняется и как встроенный скрипт (через toString), поэтому всё нужное
 * должно лежать внутри: ссылка на что-то снаружи в скрипте не существует.
 */
function pickHeroPhotos(grid: HTMLElement | null) {
  // Отметка — свойство узла, а не атрибут: атрибут, которого нет в
  // серверной разметке, React при оживлении страницы счёл бы расхождением.
  const node = grid as (HTMLElement & { floriaPicked?: boolean }) | null;
  if (!node || node.floriaPicked) return;
  node.floriaPicked = true;

  const key = "floria.hero.v1";
  let last: string[] = [];
  try {
    last = JSON.parse(localStorage.getItem(key) || "[]");
  } catch {}

  const shown: string[] = [];
  node.querySelectorAll("[data-hero-slot]").forEach((slot) => {
    const items = Array.from(slot.querySelectorAll<HTMLElement>("[data-hero-photo]"));
    if (items.length === 0) return;
    const fresh = items.filter((item) => last.indexOf(item.dataset.heroPhoto || "") < 0);
    const from = fresh.length > 0 ? fresh : items;
    const pick = from[Math.floor(Math.random() * from.length)];
    items.forEach((item) => {
      item.hidden = item !== pick;
    });
    shown.push(pick.dataset.heroPhoto || "");
  });

  try {
    localStorage.setItem(key, JSON.stringify(shown));
  } catch {}
}

const INLINE = `(${pickHeroPhotos.toString()})(document.currentScript&&document.currentScript.parentElement)`;

/** Ставится последним элементом внутрь сетки с окнами. */
export function HeroShuffle() {
  const ref = useRef<HTMLScriptElement>(null);

  useLayoutEffect(() => {
    pickHeroPhotos(ref.current?.parentElement ?? null);
  }, []);

  // Текст скрипта на сервере и в браузере собран разными сборками и
  // побуквенно не совпадает — расхождение ожидаемое, предупреждать не о чем.
  return <script ref={ref} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: INLINE }} />;
}
