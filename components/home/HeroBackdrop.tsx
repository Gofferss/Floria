"use client";

import { useEffect, useRef, useState } from "react";

export type PhotoAccent = {
  src: string;
  alt: string;
  top: string;
  left: string;
  size: string;
  depth: number;
  delay: string;
  rotate: number;
  anim: "motion-safe:animate-float-slow" | "motion-safe:animate-float-fast";
};

/**
 * Живой фон главного блока: два медленно "дышащих" градиентных пятна
 * (keyframe blob, tailwind.config.ts) и парящие фото одиночных цветов
 * по краям — список уже отфильтрован в Hero.tsx (server) до тех файлов,
 * что реально лежат в /public, так что здесь просто рендерим, что пришло.
 * Раньше здесь ещё были два тонких line-art завитка — убраны по просьбе
 * пользователя (не вписывались в стиль вместе с остальными svg-рисунками).
 * Интерактивность: на устройствах с точным указателем (мышь) всё это
 * слегка смещается вслед за курсором — на тач-устройствах не подключается.
 *
 * "use client" оправдан только этим — сам Hero остаётся серверным
 * компонентом, backdrop встроен в него как самостоятельный клиентский узел.
 */
export function HeroBackdrop({ accents }: { accents: PhotoAccent[] }) {
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

      {accents.map((photo, index) => (
        <img
          key={index}
          src={photo.src}
          alt={photo.alt}
          className={`absolute ${photo.size} object-contain drop-shadow-lg ${photo.anim}`}
          style={{
            top: photo.top,
            left: photo.left,
            animationDelay: photo.delay,
            transform: `translate3d(${pointer.x * photo.depth}px, ${pointer.y * photo.depth}px, 0) rotate(${photo.rotate}deg)`,
            transition: "transform 0.6s ease-out",
          }}
        />
      ))}
    </div>
  );
}
