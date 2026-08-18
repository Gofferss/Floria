"use client";

import { useEffect, useRef, useState } from "react";
import type { Story } from "@/lib/stories";
import { StoryViewer } from "@/components/home/StoryViewer";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { trackEvent } from "@/lib/analytics/track";

// ================================================================
// Карусель "актуального". Раньше ряд кружков растягивался на всю
// ширину блока (max-w-3xl), а стрелки стояли по его краям — получался
// большой пустой зазор между стрелкой и ближайшим видимым кружком.
// Теперь ширина ленты = ровно столько, сколько занимают видимые кружки
// (RAIL_WIDTH), а стрелки — соседи этой ленты в одном flex-ряду,
// который сам центрируется по контенту (w-fit + mx-auto). Так блок
// не "растекается" по странице и стрелки всегда рядом с кружками.
//
// Кольцо и подпись: вместо белой окантовки — тонкая тень + едва заметное
// кольцо (ring-black/5), а вокруг активного кружка — золотое кольцо-
// таймер, которое буквально показывает 5 секунд до автолистания
// (тот же приём, что и в progress-баре внутри самой сторис). Подпись
// теперь видна под каждым кружком, просто тускнеет к краям вместе с
// самим кружком — не мигает туда-обратно.
// ================================================================

const AUTO_ADVANCE_MS = 5000;
const CIRCLE_SIZE = 60;
const SPACING = 54;
const MAX_VISIBLE_DISTANCE = 2;
const RAIL_WIDTH = MAX_VISIBLE_DISTANCE * 2 * SPACING + CIRCLE_SIZE;
const RING_R = 27;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;

/** Кратчайшее "круговое" расстояние от index до center по кольцу длины n. */
function circularDistance(index: number, center: number, n: number): number {
  let d = index - center;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

export function StoriesRailClient({ stories }: { stories: Story[] }) {
  const [centerIndex, setCenterIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<{ storyIndex: number; itemIndex: number } | null>(null);
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

  return (
    <section
      className="relative overflow-hidden border-y border-lavender-100/70 bg-gradient-to-b from-lavender-50/60 via-white to-white py-8 sm:py-10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="mx-auto flex w-fit max-w-full items-center gap-2.5 overflow-x-auto px-3 sm:gap-4 sm:px-4">
        <button
          type="button"
          onClick={() => goTo(-1)}
          aria-label="Предыдущие истории"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-lavender-200 bg-white text-ink/50 shadow-sm transition hover:border-gold-300 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
        >
          <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
        </button>

        <div className="relative shrink-0" style={{ width: RAIL_WIDTH, height: CIRCLE_SIZE + 34 }}>
          {stories.map((story, index) => {
            const d = circularDistance(index, centerIndex, n);
            const absD = Math.abs(d);
            const visible = absD <= MAX_VISIBLE_DISTANCE;
            const scale = Math.max(0.52, 1 - absD * 0.24);
            const opacity = visible ? Math.max(0.4, 1 - absD * 0.3) : 0;
            const isCenter = d === 0;

            return (
              <button
                key={story.id}
                type="button"
                onClick={() => openStory(index)}
                aria-label={story.title}
                tabIndex={visible ? 0 : -1}
                className="absolute left-1/2 top-0 flex flex-col items-center gap-1.5 rounded-full transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
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
                      <span
                        aria-hidden="true"
                        className="absolute -inset-2 -z-10 rounded-full bg-gold-300/30 blur-lg"
                      />
                      <svg
                        key={centerIndex}
                        aria-hidden="true"
                        viewBox={`0 0 ${CIRCLE_SIZE} ${CIRCLE_SIZE}`}
                        className="absolute -inset-[3px] -rotate-90 motion-reduce:hidden"
                      >
                        <circle
                          cx={CIRCLE_SIZE / 2}
                          cy={CIRCLE_SIZE / 2}
                          r={RING_R}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="animate-story-ring text-gold-400"
                          strokeDasharray={RING_CIRCUMFERENCE}
                          strokeDashoffset={RING_CIRCUMFERENCE}
                          style={{
                            animationDuration: `${AUTO_ADVANCE_MS}ms`,
                            animationPlayState: isRunning ? "running" : "paused",
                          }}
                        />
                      </svg>
                    </>
                  )}
                  <span className="h-full w-full overflow-hidden rounded-full shadow-sm ring-1 ring-black/5">
                    {story.coverImage ? (
                      <img src={story.coverImage} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="block h-full w-full bg-lavender-100" />
                    )}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="max-w-[74px] truncate font-body text-[11px] leading-tight text-ink transition-opacity duration-500 motion-reduce:transition-none"
                  style={{ opacity: Math.max(0.5, 1 - absD * 0.32), fontWeight: isCenter ? 600 : 400 }}
                >
                  {story.title}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => goTo(1)}
          aria-label="Следующие истории"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-lavender-200 bg-white text-ink/50 shadow-sm transition hover:border-gold-300 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
        >
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </button>
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
