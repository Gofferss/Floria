"use client";

import { useEffect, useRef, useState } from "react";

// ================================================================
// Размытые цветные пятна — «живой» фон главной.
//
// Раньше наборов было два: свой у хиро и свой у блока поводов. Каждая
// секция обрезала своё содержимое (overflow-hidden), и пятно упиралось
// в границу секции, обрываясь ровной горизонтальной линией — те самые
// швы, которые видно на стыках. Градиент под ними был уже сплошной,
// шов давали именно обрезанные пятна.
//
// Теперь слой один и лежит на всём полотне (.home-canvas). Обрезка
// осталась только по внешнему краю страницы, где ей и место, а внутри
// пятна свободно перетекают из блока в блок.
// ================================================================

/**
 * Позиции по вертикали — в процентах от высоты всего полотна, а не от
 * секции. Подобраны так, чтобы пятно не садилось ровно на стык блоков:
 * там оно и создавало бы впечатление границы.
 */
const BLOBS = [
  { top: "-6%", side: "left", offset: "-18%", size: "w-[70vw] h-[70vw]", color: "bg-gold-300/30", depth: 10, anim: "motion-safe:animate-blob" },
  { top: "18%", side: "right", offset: "-22%", size: "w-[75vw] h-[75vw]", color: "bg-lavender-300/40", depth: -14, anim: "motion-safe:animate-blob-reverse" },
  { top: "46%", side: "left", offset: "-24%", size: "w-[60vw] h-[60vw]", color: "bg-gold-300/20", depth: 8, anim: "motion-safe:animate-blob" },
  { top: "72%", side: "right", offset: "-20%", size: "w-[65vw] h-[65vw]", color: "bg-lavender-300/30", depth: -10, anim: "motion-safe:animate-blob-reverse" },
] as const;

/**
 * Слежение за курсором — только на устройствах с точным указателем.
 * "use client" оправдан исключительно этим: страница и все её секции
 * остаются серверными компонентами, слой встроен отдельным узлом.
 */
export function AmbientBlobs() {
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
          // По вертикали ориентируемся на окно, а не на полотно: оно выше
          // экрана в несколько раз, и доля от его высоты почти не менялась
          // бы при движении мыши.
          y: (e.clientY / window.innerHeight) * 2 - 1,
        });
        pending = false;
      });
    }

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [interactive]);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
      {BLOBS.map((blob, index) => (
        <div
          key={index}
          className={`absolute rounded-full blur-3xl ${blob.size} ${blob.color} ${blob.anim}`}
          style={{
            top: blob.top,
            [blob.side]: blob.offset,
            transform: `translate3d(${pointer.x * blob.depth}px, ${pointer.y * blob.depth}px, 0)`,
            transition: "transform 0.5s ease-out",
          }}
        />
      ))}
    </div>
  );
}
