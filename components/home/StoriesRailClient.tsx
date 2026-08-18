"use client";

import { useEffect, useRef, useState } from "react";
import type { Story } from "@/lib/stories";
import { StoryViewer } from "@/components/home/StoryViewer";
import { trackEvent } from "@/lib/analytics/track";

// ================================================================
// Второй заход на карусель "актуального" — первая версия на десктопе
// смотрелась мелко и зажато, а стрелки по бокам всё равно расширяли
// блок. Здесь: кружки крупнее (в полтора раза на десктопе), стрелок
// нет вовсе — соседний кружок кликом становится центральным, свайп/
// протяжка мышью работает так же. У каждого кружка — тонкая золотая
// рамка (не просто белая обводка), у активного она "дозаполняется"
// кольцом-таймером до следующего автолистания через 5 секунд.
//
// Два набора размеров (мобильный/десктопный) переключаются через
// matchMedia — точные пиксельные трансформы (translateX/scale) проще
// считать так, чем городить их через vw/clamp.
// ================================================================

const AUTO_ADVANCE_MS = 5000;
const SIZES = {
  mobile: { circle: 84, spacing: 66, visible: 1 },
  desktop: { circle: 112, spacing: 96, visible: 2 },
};
const RING_STROKE = 2.5;

/** Кратчайшее "круговое" расстояние от index до center по кольцу длины n. */
function circularDistance(index: number, center: number, n: number): number {
  let d = index - center;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

function useSizes() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    setDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return desktop ? SIZES.desktop : SIZES.mobile;
}

export function StoriesRailClient({ stories }: { stories: Story[] }) {
  const [centerIndex, setCenterIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<{ storyIndex: number; itemIndex: number } | null>(null);
  const { circle: CIRCLE_SIZE, spacing: SPACING, visible: MAX_VISIBLE_DISTANCE } = useSizes();
  const RING_R = CIRCLE_SIZE / 2 - RING_STROKE / 2;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;
  const RAIL_WIDTH = MAX_VISIBLE_DISTANCE * 2 * SPACING + CIRCLE_SIZE;
  const n = stories.length;
  const isRunning = !paused && !open;

  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isRunning) return;
    timerRef.current = window.setInterval(() => {
      setCenterIndex((c) => (c + 1) % n);
    }, AUTO_ADVANCE_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [isRunning, n]);

  function goTo(delta: number) {
    setCenterIndex((c) => (((c + delta) % n) + n) % n);
  }

  function openStory(index: number) {
    trackEvent("story_open", stories[index].title);
    setOpen({ storyIndex: index, itemIndex: 0 });
  }

  // Протяжка мышью/пальцем вместо стрелок — порог в 6px отличает клик от
  // жеста, порог в 40px решает, в какую сторону листать. suppressClickRef
  // гасит клик, который браузер всё равно отправит по отпусканию после
  // жеста (иначе протяжка попутно "открывала" бы историю).
  const dragRef = useRef<{ startX: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { startX: e.clientX, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    if (Math.abs(e.clientX - dragRef.current.startX) > 6) dragRef.current.moved = true;
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    if (dragRef.current.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 150);
    }
    if (Math.abs(dx) > 40) goTo(dx < 0 ? 1 : -1);
    dragRef.current = null;
  }

  function handleCircleClick(index: number, isCenter: boolean) {
    if (suppressClickRef.current) return;
    if (isCenter) {
      openStory(index);
    } else {
      setCenterIndex(index);
    }
  }

  return (
    <section
      className="relative overflow-hidden border-y border-lavender-100/70 bg-gradient-to-b from-lavender-50/60 via-white to-white py-10 sm:py-14"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className="relative mx-auto touch-pan-y select-none"
        style={{ width: RAIL_WIDTH, height: CIRCLE_SIZE + 40, touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {stories.map((story, index) => {
          const d = circularDistance(index, centerIndex, n);
          const absD = Math.abs(d);
          const visible = absD <= MAX_VISIBLE_DISTANCE;
          const scale = Math.max(0.5, 1 - absD * 0.26);
          const opacity = visible ? Math.max(0.4, 1 - absD * 0.3) : 0;
          const isCenter = d === 0;

          return (
            <button
              key={story.id}
              type="button"
              onClick={() => handleCircleClick(index, isCenter)}
              aria-label={isCenter ? `Открыть: ${story.title}` : `Показать: ${story.title}`}
              tabIndex={visible ? 0 : -1}
              className="absolute left-1/2 top-0 flex cursor-pointer flex-col items-center gap-2 rounded-full transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
              style={{
                transform: `translateX(calc(-50% + ${d * SPACING}px)) scale(${scale})`,
                opacity,
                zIndex: 20 - absD,
                pointerEvents: visible ? "auto" : "none",
              }}
            >
              <span className="relative flex shrink-0 items-center justify-center" style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}>
                {isCenter && (
                  <>
                    <span aria-hidden="true" className="absolute -inset-3 -z-10 rounded-full bg-gold-300/30 blur-xl" />
                    <svg
                      key={centerIndex}
                      aria-hidden="true"
                      viewBox={`0 0 ${CIRCLE_SIZE} ${CIRCLE_SIZE}`}
                      className="absolute inset-0 -rotate-90 motion-reduce:hidden"
                    >
                      <circle
                        cx={CIRCLE_SIZE / 2}
                        cy={CIRCLE_SIZE / 2}
                        r={RING_R}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={RING_STROKE}
                        strokeLinecap="round"
                        className="animate-story-ring text-gold-400"
                        strokeDasharray={RING_CIRCUMFERENCE}
                        strokeDashoffset={RING_CIRCUMFERENCE}
                        style={{
                          animationDuration: `${AUTO_ADVANCE_MS}ms`,
                          animationPlayState: isRunning ? "running" : "paused",
                          ["--ring-c" as string]: RING_CIRCUMFERENCE,
                        }}
                      />
                    </svg>
                  </>
                )}
                <span
                  className={`h-full w-full overflow-hidden rounded-full shadow-md transition ${
                    isCenter ? "" : "ring-2 ring-gold-300/45 hover:ring-gold-400/70"
                  }`}
                >
                  {story.coverImage ? (
                    <img src={story.coverImage} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="block h-full w-full bg-lavender-100" />
                  )}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="max-w-[92px] truncate font-body text-[13px] leading-tight text-ink transition-opacity duration-500 motion-reduce:transition-none"
                style={{ opacity: Math.max(0.5, 1 - absD * 0.3), fontWeight: isCenter ? 600 : 400 }}
              >
                {story.title}
              </span>
            </button>
          );
        })}
      </div>

      {open && (
        <StoryViewer
          stories={stories}
          storyIndex={open.storyIndex}
          itemIndex={open.itemIndex}
          onNavigate={(storyIndex, itemIndex) => setOpen({ storyIndex, itemIndex })}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
