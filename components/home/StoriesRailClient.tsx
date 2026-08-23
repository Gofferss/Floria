"use client";

import { useEffect, useMemo, useState } from "react";
import type { Story } from "@/lib/stories";
import { StoryViewer } from "@/components/home/StoryViewer";
import { trackEvent } from "@/lib/analytics/track";

// ================================================================
// Третий заход на «актуальное». Прежняя версия была каруселью с
// увеличенным центром и кольцом-таймером, которое дозаполнялось до
// автолистания. От неё отказались осознанно: кружки разного размера
// читаются как разные по важности, а бегущее кольцо тянет взгляд на
// себя — в хиро-блоке, где главное это заголовок и кнопка, лишний
// движущийся элемент мешает.
//
// Теперь: ряд ОДИНАКОВЫХ кружков в градиентном кольце, без бегущей
// анимации. Листание включается только когда истории физически не
// помещаются — на десктопе места на 6, на телефоне на 4, и вот там
// прокрутка нужна. Если историй меньше, ряд просто стоит по центру.
// ================================================================

const ROTATE_MS = 4000;

/**
 * Размер кружка и сколько их помещается — по брейкпоинтам. Пиксели, а не
 * vw/clamp: сдвиг ленты считается точным translateX, и дробные значения из
 * относительных единиц дают подрагивание на границе кадра.
 */
const LAYOUT = {
  mobile: { circle: 68, gap: 14, perPage: 4 },
  tablet: { circle: 76, gap: 18, perPage: 5 },
  desktop: { circle: 84, gap: 22, perPage: 6 },
} as const;

type Layout = (typeof LAYOUT)[keyof typeof LAYOUT];

function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(LAYOUT.mobile);

  useEffect(() => {
    const tablet = window.matchMedia("(min-width: 640px)");
    const desktop = window.matchMedia("(min-width: 1024px)");

    const apply = () => {
      setLayout(desktop.matches ? LAYOUT.desktop : tablet.matches ? LAYOUT.tablet : LAYOUT.mobile);
    };

    apply();
    tablet.addEventListener("change", apply);
    desktop.addEventListener("change", apply);
    return () => {
      tablet.removeEventListener("change", apply);
      desktop.removeEventListener("change", apply);
    };
  }, []);

  return layout;
}

export function StoriesRailClient({ stories }: { stories: Story[] }) {
  const { circle, gap, perPage } = useLayout();
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<{ storyIndex: number; itemIndex: number } | null>(null);
  const [animate, setAnimate] = useState(true);

  const n = stories.length;
  const needsRotation = n > perPage;
  const step = circle + gap;

  // Для бесшовной петли лента содержит второй проход списка: доехав до
  // конца первого, мгновенно (без анимации) возвращаемся в начало — глазу
  // это незаметно, потому что картинка в этот момент совпадает.
  const track = useMemo(() => (needsRotation ? [...stories, ...stories] : stories), [stories, needsRotation]);

  const isRunning = needsRotation && !paused && !open;

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setOffset((o) => o + 1), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  // Возврат в начало петли после того, как доехали до конца первого прохода.
  useEffect(() => {
    if (!needsRotation || offset < n) return;
    const timer = window.setTimeout(() => {
      setAnimate(false);
      setOffset(0);
      // Анимацию возвращаем следующим кадром, иначе снимется вместе со сбросом.
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [offset, n, needsRotation]);

  function openStory(index: number) {
    trackEvent("story_open", stories[index].title);
    setOpen({ storyIndex: index, itemIndex: 0 });
  }

  const viewportWidth = Math.min(n, perPage) * step - gap;

  return (
    <div
      className="mt-10 sm:mt-14"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="mx-auto overflow-hidden" style={{ width: viewportWidth, maxWidth: "100%" }}>
        <div
          className="flex"
          style={{
            gap,
            transform: `translateX(-${offset * step}px)`,
            transition: animate ? "transform 600ms cubic-bezier(0.4, 0, 0.2, 1)" : "none",
          }}
        >
          {track.map((story, index) => {
            const storyIndex = index % n;
            return (
              <button
                key={`${story.id}-${index}`}
                type="button"
                onClick={() => openStory(storyIndex)}
                aria-label={`Открыть: ${story.title}`}
                // Дубликаты второго прохода — только для гладкой петли, с
                // клавиатуры до них добираться не надо: это те же истории.
                tabIndex={index < n ? 0 : -1}
                aria-hidden={index >= n}
                className="group flex shrink-0 cursor-pointer flex-col items-center gap-2 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
                style={{ width: circle }}
              >
                {/* Градиентное кольцо: внешний слой — сам градиент, средний
                    белый отделяет его от фотографии, как на референсе. */}
                <span
                  className="block rounded-full bg-gradient-to-br from-gold-400 via-gold-300 to-lavender-500 p-[2.5px] transition duration-300 group-hover:from-lavender-500 group-hover:to-gold-400 group-hover:shadow-lg"
                  style={{ width: circle, height: circle }}
                >
                  <span className="block h-full w-full rounded-full bg-white p-[2px]">
                    <span className="block h-full w-full overflow-hidden rounded-full">
                      {story.coverImage ? (
                        <img
                          src={story.coverImage}
                          alt=""
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <span className="block h-full w-full bg-lavender-100" />
                      )}
                    </span>
                  </span>
                </span>

                <span
                  aria-hidden="true"
                  className="line-clamp-2 text-center font-display text-[10px] font-semibold uppercase leading-tight tracking-wide text-ink/75 transition group-hover:text-gold-700 sm:text-[11px]"
                >
                  {story.title}
                </span>
              </button>
            );
          })}
        </div>
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
    </div>
  );
}
