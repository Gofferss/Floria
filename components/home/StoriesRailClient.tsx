"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
 * Ленту можно тянуть пальцем или мышью — раньше она крутилась только сама,
 * и историю, не попавшую на экран, приходилось ждать. Пока тянут и ещё
 * немного после — сама не крутится, чтобы человек успел нажать.
 */
const DRAG_START_PX = 8;
const FLICK_PX = 24;
const RESUME_AFTER_DRAG_MS = 5000;

// Просмотренные истории — без градиентного кольца, как в Instagram.
// Храним в браузере посетителя: это его отметки, на сервер их нести незачем.
// Ключ — история и время её правки: изменённая история снова «новая».
const SEEN_KEY = "floria.stories.seen.v1";
const SEEN_LIMIT = 200;

const seenId = (story: Story) => `${story.id}:${story.updatedAt}`;

function readSeen(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Размер кружка и сколько их помещается — по брейкпоинтам. Пиксели, а не
 * vw/clamp: сдвиг ленты считается точным translateX, и дробные значения из
 * относительных единиц дают подрагивание на границе кадра.
 */
const LAYOUT = {
  // Шаг = circle + gap. На мобильном ряд обязан уложиться в 375 - 32 (поля
  // px-4) = 343px: 4 × (76 + 12) − 12 = 340. Поэтому при укрупнении кружка
  // зазор пришлось поджать — иначе четвёртый вылезал бы за экран.
  mobile: { circle: 76, gap: 12, perPage: 4 },
  tablet: { circle: 88, gap: 16, perPage: 5 },
  desktop: { circle: 98, gap: 20, perPage: 6 },
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

  // До монтирования — пусто: на сервере localStorage нет, и все кольца
  // сначала цветные; отметки подхватываются сразу после загрузки.
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  useEffect(() => setSeen(new Set(readSeen())), []);

  function markSeen(index: number) {
    const story = stories[index];
    if (!story || seen.has(seenId(story))) return;
    const next = [...readSeen().filter((key) => !key.startsWith(`${story.id}:`)), seenId(story)].slice(-SEEN_LIMIT);
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {
      // приватный режим или запрет хранилища — просто не запомним
    }
    setSeen(new Set(next));
  }

  function openStory(index: number) {
    trackEvent("story_open", stories[index].title);
    markSeen(index);
    setOpen({ storyIndex: index, itemIndex: 0 });
  }

  // --- Перетаскивание ленты ---
  const [dragPx, setDragPx] = useState<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; base: number; moved: boolean } | null>(null);
  // Отпускание после перетаскивания — не нажатие на кружок под пальцем.
  const suppressClickRef = useRef(false);
  const resumeTimerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(resumeTimerRef.current), []);

  // Лента — два прохода одного списка, поэтому сдвиг берём по кругу длиной
  // в один проход: картинка при переходе через край не меняется.
  const loopPx = n * step;
  const wrap = (px: number) => ((px % loopPx) + loopPx) % loopPx;

  // Движение и отпускание слушаем на всём окне, а не на ленте: резкий
  // рывок мышью уводит указатель за край ленты быстрее, чем она получит
  // хоть одно движение, — и жест терялся. Захватывать указатель при
  // нажатии нельзя: тогда нажатие на кружок перестаёт быть нажатием.
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    suppressClickRef.current = false;
    if (!needsRotation || (e.pointerType === "mouse" && e.button !== 0)) return;
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, base: offset * step, moved: false };

    const onMove = (ev: PointerEvent) => handlePointerMove(ev);
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      handlePointerEnd(ev);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  function handlePointerMove(e: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved) {
      // Мелкое дрожание пальца при нажатии — ещё не перетаскивание.
      if (Math.abs(dx) < DRAG_START_PX) return;
      drag.moved = true;
      window.clearTimeout(resumeTimerRef.current);
      setPaused(true);
    }
    setDragPx(wrap(drag.base - dx));
  }

  function handlePointerEnd(e: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return;

    suppressClickRef.current = true;
    const dx = e.clientX - drag.startX;
    // Листаем на столько кружков, сколько протянули. Короткий рывок — на
    // один: иначе лента откатывалась бы назад, и казалось бы, что жест не
    // сработал.
    let steps = Math.round(-dx / step);
    if (steps === 0 && Math.abs(dx) > FLICK_PX) steps = dx < 0 ? 1 : -1;
    // Тот же кружок на ленте есть дважды (два прохода) — берём копию
    // ближе к тому месту, где ленту отпустили, иначе она пролетела бы
    // через весь круг.
    const at = wrap(drag.base - dx) / step;
    let target = drag.base / step + steps;
    target -= n * Math.round((target - at) / n);
    if (target < 0) target += n;
    setDragPx(null);
    setOffset(target);
    resumeTimerRef.current = window.setTimeout(() => {
      if (!hoveredRef.current) setPaused(false);
    }, RESUME_AFTER_DRAG_MS);
  }

  // Мышь над лентой — тоже пауза; таймер после перетаскивания её не снимает.
  const hoveredRef = useRef(false);

  const viewportWidth = Math.min(n, perPage) * step - gap;

  return (
    <div
      className="mt-10 sm:mt-14"
      onMouseEnter={() => {
        hoveredRef.current = true;
        setPaused(true);
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        // Только что тянули — даём досмотреть, отпустит таймер.
        if (!dragRef.current) setPaused(false);
      }}
    >
      {/* Нажатие ловим на видимом окне ленты, а не на самой ленте: она
          шире окна и сдвинута трансформом, и промежутки между кружками за
          её собственным краем ей не принадлежат — нажатие туда не тянуло. */}
      <div
        className={`mx-auto select-none overflow-hidden ${
          needsRotation ? (dragPx === null ? "cursor-grab" : "cursor-grabbing") : ""
        }`}
        style={{
          width: viewportWidth,
          maxWidth: "100%",
          // Вертикальную прокрутку страницы оставляем браузеру, горизонталь — наша.
          touchAction: needsRotation ? "pan-y" : undefined,
        }}
        onPointerDown={handlePointerDown}
      >
        <div
          className="flex"
          style={{
            gap,
            transform: `translateX(-${dragPx ?? offset * step}px)`,
            transition: animate && dragPx === null ? "transform 600ms cubic-bezier(0.4, 0, 0.2, 1)" : "none",
          }}
        >
          {track.map((story, index) => {
            const storyIndex = index % n;
            const isSeen = seen.has(seenId(story));
            return (
              <button
                key={`${story.id}-${index}`}
                type="button"
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  openStory(storyIndex);
                }}
                aria-label={`Открыть: ${story.title}`}
                // Дубликаты второго прохода — только для гладкой петли, с
                // клавиатуры до них добираться не надо: это те же истории.
                tabIndex={index < n ? 0 : -1}
                aria-hidden={index >= n}
                className="group flex shrink-0 cursor-pointer flex-col items-center gap-2 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
                style={{ width: circle }}
              >
                {/* Градиентное кольцо: внешний слой — сам градиент, средний
                    белый отделяет его от фотографии, как на референсе.
                    Просмотренная история — тонкое серое кольцо, и сразу
                    видно, что новое, а что уже смотрели. */}
                <span
                  className={`block rounded-full transition duration-300 group-hover:shadow-lg ${
                    isSeen
                      ? "bg-ink/15 p-[1.5px]"
                      : "bg-gradient-to-br from-gold-400 via-gold-300 to-lavender-500 p-[2.5px] group-hover:from-lavender-500 group-hover:to-gold-400"
                  }`}
                  style={{ width: circle, height: circle }}
                >
                  <span className={`block h-full w-full rounded-full bg-white ${isSeen ? "p-[3px]" : "p-[2px]"}`}>
                    <span className="block h-full w-full overflow-hidden rounded-full">
                      {story.coverImage ? (
                        <img
                          src={story.coverImage}
                          alt=""
                          // Иначе мышь начинает перетаскивать саму картинку,
                          // а не ленту.
                          draggable={false}
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
          onNavigate={(storyIndex, itemIndex) => {
            markSeen(storyIndex);
            setOpen({ storyIndex, itemIndex });
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
