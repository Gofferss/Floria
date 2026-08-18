"use client";

import { useEffect, useRef, useState } from "react";
import type { Story } from "@/lib/stories";
import { StoryViewer } from "@/components/home/StoryViewer";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { trackEvent } from "@/lib/analytics/track";

// ================================================================
// Карусель "актуального" — центральный кружок крупный и чёткий, к
// краям соседние уменьшаются и тускнеют (та же идея, что в примере,
// который прислал пользователь), сама едет по кругу раз в 5 секунд,
// бесконечно в обе стороны (по модулю индекса, без реального дублирования
// DOM-узлов — так проще держать анимацию плавной при любом количестве
// историй). Пауза на время наведения — иначе не даёт прицельно кликнуть.
// ================================================================

const AUTO_ADVANCE_MS = 5000;
const CIRCLE_SIZE = 76;
const SPACING = 92;
const MAX_VISIBLE_DISTANCE = 3;

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

  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (paused || open) return;
    timerRef.current = window.setInterval(() => {
      setCenterIndex((c) => (c + 1) % n);
    }, AUTO_ADVANCE_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [paused, open, n]);

  function goTo(delta: number) {
    setCenterIndex((c) => (((c + delta) % n) + n) % n);
  }

  function openStory(index: number) {
    trackEvent("story_open", stories[index].title);
    setOpen({ storyIndex: index, itemIndex: 0 });
  }

  return (
    <section
      className="border-y border-lavender-100/70 bg-white py-8 sm:py-10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative mx-auto flex max-w-3xl items-center justify-center px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => goTo(-1)}
          aria-label="Предыдущие истории"
          className="absolute left-2 z-20 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-lavender-200 bg-white text-ink/50 opacity-60 shadow-sm transition hover:text-ink hover:opacity-100"
        >
          <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
        </button>

        <div
          className="relative w-full overflow-hidden"
          style={{ height: CIRCLE_SIZE + 44 }}
        >
          {stories.map((story, index) => {
            const d = circularDistance(index, centerIndex, n);
            const absD = Math.abs(d);
            const visible = absD <= MAX_VISIBLE_DISTANCE;
            const scale = Math.max(0.32, 1 - absD * 0.22);
            const opacity = visible ? Math.max(0, 1 - absD * 0.32) : 0;
            const isCenter = d === 0;

            return (
              <button
                key={story.id}
                type="button"
                onClick={() => openStory(index)}
                aria-label={story.title}
                tabIndex={visible ? 0 : -1}
                className="absolute left-1/2 top-0 flex flex-col items-center gap-2 transition-[transform,opacity] duration-700 ease-out"
                style={{
                  transform: `translateX(calc(-50% + ${d * SPACING}px)) scale(${scale})`,
                  opacity,
                  zIndex: 20 - absD,
                  pointerEvents: visible ? "auto" : "none",
                }}
              >
                <span
                  className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold-400 via-gold-500 to-lavender-500 p-[3px] transition ${
                    isCenter ? "shadow-lg shadow-gold-500/20" : ""
                  }`}
                  style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}
                >
                  <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-white p-[3px]">
                    {story.coverImage ? (
                      <img src={story.coverImage} alt="" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      <span className="h-full w-full rounded-full bg-lavender-100" />
                    )}
                  </span>
                </span>
                <span
                  className="max-w-[100px] truncate font-body text-xs text-ink/70 transition-opacity duration-500"
                  style={{ opacity: isCenter ? 1 : 0 }}
                >
                  {isCenter ? story.title : ""}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => goTo(1)}
          aria-label="Следующие истории"
          className="absolute right-2 z-20 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-lavender-200 bg-white text-ink/50 opacity-60 shadow-sm transition hover:text-ink hover:opacity-100"
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
