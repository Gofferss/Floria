"use client";

import { useEffect, useRef, useState } from "react";
import { LeafIcon, SparkleIcon, TulipIcon, BouquetIcon } from "@/components/ui/Icons";

type Petal = {
  Icon: typeof LeafIcon;
  top: string;
  left: string;
  size: string;
  depth: number;
  delay: string;
  rotate: number;
  anim: "motion-safe:animate-float-slow" | "motion-safe:animate-float-fast";
};

const PETALS: Petal[] = [
  { Icon: TulipIcon, top: "14%", left: "10%", size: "h-8 w-8", depth: 16, delay: "0s", rotate: -12, anim: "motion-safe:animate-float-slow" },
  { Icon: LeafIcon, top: "70%", left: "16%", size: "h-6 w-6", depth: 10, delay: "1.2s", rotate: 22, anim: "motion-safe:animate-float-fast" },
  { Icon: SparkleIcon, top: "20%", left: "86%", size: "h-5 w-5", depth: 22, delay: "0.6s", rotate: 0, anim: "motion-safe:animate-float-fast" },
  { Icon: BouquetIcon, top: "78%", left: "80%", size: "h-7 w-7", depth: 14, delay: "2s", rotate: 10, anim: "motion-safe:animate-float-slow" },
  { Icon: SparkleIcon, top: "50%", left: "6%", size: "h-4 w-4", depth: 26, delay: "1.8s", rotate: 0, anim: "motion-safe:animate-float-fast" },
];

/**
 * Живой фон главного блока: два медленно "дышащих" градиентных пятна
 * (keyframe blob, tailwind.config.ts) + парящие цветочные силуэты
 * (float-slow/fast — те же, что уже использовались в Hero для боковых
 * паттернов). Интерактивность: на устройствах с точным указателем (мышь)
 * пятна и силуэты слегка смещаются вслед за курсором — на тач-устройствах
 * не подключается вовсе, там это бессмысленно.
 *
 * "use client" оправдан только этим — сам Hero остаётся серверным
 * компонентом, backdrop встроен в него как самостоятельный клиентский узел.
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

      {PETALS.map((petal, index) => {
        const Icon = petal.Icon;
        return (
          <div
            key={index}
            className={`absolute ${petal.size} text-gold-600/30 ${petal.anim}`}
            style={{
              top: petal.top,
              left: petal.left,
              animationDelay: petal.delay,
              transform: `translate3d(${pointer.x * petal.depth}px, ${pointer.y * petal.depth}px, 0) rotate(${petal.rotate}deg)`,
              transition: "transform 0.6s ease-out",
            }}
          >
            <Icon className="h-full w-full" />
          </div>
        );
      })}
    </div>
  );
}
