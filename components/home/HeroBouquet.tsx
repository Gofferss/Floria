"use client";

import { useEffect, useRef, useState } from "react";

// ================================================================
// Заменяет старый плейсхолдер /hero-bouquet.png (буквально плоский
// прямоугольник с текстом "Hero Bouquet"). Букет собран из тех же
// приёмов, что уже использует BotanicalPattern (трилистник/квадрифолий
// из окружностей — тюльпан отсюда же, путь 1:1), просто крупнее и в
// цвете. Взаимодействие: на устройствах с мышью — лёгкий параллакс по
// курсору (глубже цветок — сильнее сдвиг), у каждого бутона своё
// медленное "дыхание" (float, тот же keyframe, что у HeroBackdrop), и
// мягкое свечение при наведении на весь букет.
// ================================================================

type Bloom = {
  cx: number;
  cy: number;
  r: number;
  kind: "quad" | "tri";
  petal: string;
  center: string;
  depth: number;
  delay: number;
  anim: "motion-safe:animate-float-slow" | "motion-safe:animate-float-fast";
};

const BLOOMS: Bloom[] = [
  { cx: 240, cy: 168, r: 38, kind: "quad", petal: "url(#petalLavender)", center: "url(#dotGold)", depth: 14, delay: 0, anim: "motion-safe:animate-float-slow" },
  { cx: 160, cy: 202, r: 30, kind: "quad", petal: "url(#petalBlush)", center: "url(#dotGold)", depth: 20, delay: 0.8, anim: "motion-safe:animate-float-fast" },
  { cx: 322, cy: 196, r: 30, kind: "quad", petal: "url(#petalLavender)", center: "url(#dotBlush)", depth: 20, delay: 1.4, anim: "motion-safe:animate-float-fast" },
  { cx: 100, cy: 248, r: 21, kind: "tri", petal: "url(#petalBlush)", center: "url(#dotGold)", depth: 26, delay: 2, anim: "motion-safe:animate-float-slow" },
  { cx: 380, cy: 240, r: 21, kind: "tri", petal: "url(#petalLavender)", center: "url(#dotBlush)", depth: 26, delay: 0.4, anim: "motion-safe:animate-float-slow" },
  { cx: 196, cy: 104, r: 15, kind: "tri", petal: "url(#petalGold)", center: "url(#dotLavender)", depth: 30, delay: 1.1, anim: "motion-safe:animate-float-fast" },
  { cx: 288, cy: 110, r: 15, kind: "tri", petal: "url(#petalGold)", center: "url(#dotLavender)", depth: 30, delay: 1.9, anim: "motion-safe:animate-float-fast" },
];

const TULIP_PATH =
  "M0 0c-2.5 1-3.5 3.4-2.2 6.2C-3.8 5.6-5.5 6.4-6 8.5c2 .6 3.6.1 4.7-1 .2 1.7 1 2.9 1.3 3.5.3-.6 1.1-1.8 1.3-3.5 1.1 1.1 2.7 1.6 4.7 1-.5-2.1-2.2-2.9-3.8-2.3C3.5 3.4 2.5 1 0 0z";

function BloomShape({ cx, cy, r, kind, petal, center }: Bloom) {
  const petals =
    kind === "quad"
      ? [
          [0, -r],
          [r * 0.9, r * 0.45],
          [-r * 0.9, r * 0.45],
          [0, r * 0.85],
        ]
      : [
          [0, -r * 1.05],
          [r * 0.92, r * 0.5],
          [-r * 0.92, r * 0.5],
        ];

  return (
    <g>
      {petals.map(([dx, dy], i) => (
        <circle
          key={i}
          cx={cx + dx}
          cy={cy + dy}
          r={r}
          fill={petal}
          stroke="white"
          strokeOpacity="0.35"
          strokeWidth="1"
        />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.3} fill={center} />
    </g>
  );
}

export function HeroBouquet() {
  const ref = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [interactive, setInteractive] = useState(false);
  const [hovered, setHovered] = useState(false);

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
    <div
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative mx-auto aspect-[4/3] w-full max-w-sm sm:max-w-md lg:aspect-square lg:max-w-none"
    >
      <div
        className="absolute inset-6 rounded-full bg-lavender-200/60 blur-3xl transition-all duration-700 sm:inset-10"
        style={{ opacity: hovered ? 0.9 : 0.6 }}
        aria-hidden="true"
      />

      <svg
        viewBox="0 0 480 480"
        className="relative h-full w-full drop-shadow-xl"
        role="img"
        aria-label="Букет цветов Floria"
      >
        <defs>
          <radialGradient id="petalLavender" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#EFE7FA" />
            <stop offset="100%" stopColor="#9B7FD1" />
          </radialGradient>
          <radialGradient id="petalBlush" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#FBE4EC" />
            <stop offset="100%" stopColor="#E2A0B8" />
          </radialGradient>
          <radialGradient id="petalGold" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#F9EDB0" />
            <stop offset="100%" stopColor="#D9B531" />
          </radialGradient>
          <radialGradient id="dotGold" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#F5D631" />
            <stop offset="100%" stopColor="#9C810D" />
          </radialGradient>
          <radialGradient id="dotBlush" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#F6C9D8" />
            <stop offset="100%" stopColor="#C97B96" />
          </radialGradient>
          <radialGradient id="dotLavender" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#CDB2ED" />
            <stop offset="100%" stopColor="#7B5FB0" />
          </radialGradient>
          <filter id="bloomGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Обёртка */}
        <path
          d="M180 322 L300 322 L272 452 L208 452 Z"
          fill="#FFFDF7"
          stroke="#D9B531"
          strokeWidth="1.5"
        />
        <path d="M196 340 L284 340" stroke="#F5E7A3" strokeWidth="1" />
        <path d="M202 380 L278 380" stroke="#F5E7A3" strokeWidth="1" />
        <path d="M208 420 L272 420" stroke="#F5E7A3" strokeWidth="1" />
        {/* Лента-узел */}
        <ellipse cx="222" cy="322" rx="14" ry="9" fill="#BA9B12" opacity="0.85" transform="rotate(-18 222 322)" />
        <ellipse cx="258" cy="322" rx="14" ry="9" fill="#BA9B12" opacity="0.85" transform="rotate(18 258 322)" />
        <circle cx="240" cy="322" r="6" fill="#9C810D" />

        {/* Листья */}
        <g stroke="#7B5FB0" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.55">
          <path d="M240 300c-24 6-46 22-58 46" />
          <path d="M240 300c26 4 50 18 64 40" />
        </g>

        {/* Стебли */}
        <g stroke="#9B7FD1" strokeWidth="2" opacity="0.5">
          {BLOOMS.map((b, i) => (
            <path key={i} d={`M${b.cx} ${b.cy + b.r * 0.5} Q${(b.cx + 240) / 2} ${(b.cy + 322) / 2} 240 322`} fill="none" />
          ))}
        </g>

        {/* Тюльпаны по краям */}
        <g transform="translate(76 268) rotate(-24) scale(3.4)" fill="url(#petalBlush)" stroke="#C97B96" strokeWidth="0.4">
          <path d={TULIP_PATH} />
        </g>
        <g transform="translate(404 258) rotate(22) scale(3.4)" fill="url(#petalGold)" stroke="#BA9B12" strokeWidth="0.4">
          <path d={TULIP_PATH} />
        </g>

        {/* Бутоны с параллаксом и "дыханием" */}
        {BLOOMS.map((b, i) => (
          <g
            key={i}
            style={{
              transform: `translate(${pointer.x * b.depth}px, ${pointer.y * b.depth}px)`,
              transition: "transform 0.6s ease-out",
            }}
          >
            <g
              className={b.anim}
              style={{
                animationDelay: `${b.delay}s`,
                transformOrigin: `${b.cx}px ${b.cy}px`,
                filter: hovered ? "url(#bloomGlow)" : undefined,
                transition: "filter 0.5s ease",
              }}
            >
              <BloomShape {...b} />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}
