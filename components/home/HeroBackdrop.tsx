"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Живой фон главного блока: два медленно «дышащих» градиентных пятна
 * (keyframe blob, tailwind.config.ts). На устройствах с точным указателем
 * они слегка смещаются вслед за курсором — на тач-устройствах эффект не
 * подключается.
 *
 * Парящие фото одиночных цветов отсюда убраны: по макету декор по краям
 * теперь делает контурная ботаника (HeroBotanicals), а два независимых
 * набора украшений в одном блоке спорили друг с другом. Заодно ушли
 * четыре мегабайта PNG, которые они тянули на каждый заход.
 *
 * "use client" оправдан только слежением за курсором — сам Hero остаётся
 * серверным компонентом, backdrop встроен в него отдельным узлом.
 */
export function HeroBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    setInteractive(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);

  useEffect(() => {
    if (!interactive) return;
    const el = ref.current;
    if (!el) return;

    let pending = false;
    function handleMove(e: MouseEvent) {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        const rect = el!.getBoundingClientRect();
        setPointer({
          x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
          y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
        });
        pending = false;
      });
    }

    el.addEventListener("mousemove", handleMove);
    return () => el.removeEventListener("mousemove", handleMove);
  }, [interactive]);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute -left-1/4 top-[-15%] h-[65%] w-[65%] rounded-full bg-gold-300/30 blur-3xl motion-safe:animate-blob"
        style={{
          transform: `translate3d(${pointer.x * 10}px, ${pointer.y * 10}px, 0)`,
          transition: "transform 0.5s ease-out",
        }}
      />
      <div
        className="absolute -right-1/4 bottom-[-20%] h-[70%] w-[70%] rounded-full bg-lavender-300/40 blur-3xl motion-safe:animate-blob-reverse"
        style={{
          transform: `translate3d(${pointer.x * -14}px, ${pointer.y * -14}px, 0)`,
          transition: "transform 0.5s ease-out",
        }}
      />

    </div>
  );
}
