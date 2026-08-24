"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Story } from "@/lib/stories";
import { ArrowRightIcon, CloseIcon } from "@/components/ui/Icons";

type StoryViewerProps = {
  stories: Story[];
  storyIndex: number;
  itemIndex: number;
  onNavigate: (storyIndex: number, itemIndex: number) => void;
  onClose: () => void;
};

export function StoryViewer({ stories, storyIndex, itemIndex, onNavigate, onClose }: StoryViewerProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const story = stories[storyIndex];
  const item = story?.items[itemIndex];

  function goToItem(story: number, item: number) {
    if (story < 0) {
      onClose();
      return;
    }
    if (story >= stories.length) {
      onClose();
      return;
    }
    const itemsInStory = stories[story].items.length;
    if (item < 0) {
      // Ушли за начало истории — предыдущая история, с её последнего кадра.
      const prevStory = story - 1;
      if (prevStory < 0) return onClose();
      goToItem(prevStory, stories[prevStory].items.length - 1);
      return;
    }
    if (item >= itemsInStory) {
      onNavigate(story + 1, 0);
      return;
    }
    onNavigate(story, item);
  }

  // Автопереход — фото, поэтому просто таймер на длительность слайда.
  useEffect(() => {
    if (!item) return;
    const timeoutId = window.setTimeout(() => {
      goToItem(storyIndex, itemIndex + 1);
    }, item.durationSeconds * 1000);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyIndex, itemIndex]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goToItem(storyIndex, itemIndex + 1);
      if (e.key === "ArrowLeft") goToItem(storyIndex, itemIndex - 1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyIndex, itemIndex]);

  if (!story || !item) return null;

  // До монтирования document нет — на сервере портал строить не из чего.
  if (!mounted) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/90 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={story.title}
    >
      <div
        // 82vh вместо 92vh: при 92 верх окна с крестиком подходил вплотную
        // к краю экрана, и на десктопе кнопка закрытия оказывалась под
        // шапкой. Запас по вертикали заодно даёт окну «дышать».
        className="relative aspect-[9/16] h-full max-h-[82vh] w-auto max-w-full overflow-hidden rounded-2xl bg-ink sm:h-[82vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={item.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />

        {/* Затемнение сверху — чтобы прогресс-бар и заголовок читались на любом фото */}
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink/60 to-transparent" aria-hidden="true" />

        {/* Прогресс-бар — сегмент на каждый слайд истории */}
        <div className="absolute inset-x-3 top-3 z-20 flex gap-1.5">
          {story.items.map((slide, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                className={
                  i < itemIndex
                    ? "h-full w-full bg-white"
                    : i === itemIndex
                    ? "h-full w-0 bg-white motion-safe:animate-story-progress motion-reduce:w-full"
                    : "h-full w-0 bg-white"
                }
                style={i === itemIndex ? { animationDuration: `${slide.durationSeconds}s` } : undefined}
              />
            </div>
          ))}
        </div>

        <div className="absolute left-3 right-12 top-7 z-20 font-display text-sm font-semibold text-white drop-shadow">
          {story.title}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute right-3 top-6 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/50"
        >
          <CloseIcon className="h-4 w-4" />
        </button>

        {/* Клик по левой трети — назад, по остальному — вперёд.
            z-10 — строго НИЖЕ крестика и заголовка (z-20): зоны листания
            занимают всё окно и идут в разметке позже, поэтому без явных
            слоёв они перекрывали кнопку закрытия и та не нажималась. */}
        <button
          type="button"
          onClick={() => goToItem(storyIndex, itemIndex - 1)}
          aria-label="Предыдущий слайд"
          className="absolute inset-y-0 left-0 z-10 w-1/3"
        />
        <button
          type="button"
          onClick={() => goToItem(storyIndex, itemIndex + 1)}
          aria-label="Следующий слайд"
          className="absolute inset-y-0 right-0 z-10 w-2/3"
        />

        {/* Кнопка слайда. z-20 — над зонами листания, иначе нажать её было
            бы невозможно, ровно как это случилось с крестиком.
            rel="noopener noreferrer" обязателен: без noopener открытая
            вкладка получает доступ к window.opener и может подменить нашу
            страницу. Адрес проверен и в форме, и констрейнтом в БД —
            javascript: сюда попасть не может. */}
        {item.linkUrl && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-ink/70 to-transparent px-4 pb-6 pt-12">
            <a
              href={item.linkUrl}
              target={item.linkUrl.startsWith("/") ? undefined : "_blank"}
              rel={item.linkUrl.startsWith("/") ? undefined : "noopener noreferrer"}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex max-w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-center font-display text-sm font-semibold text-ink shadow-lg transition hover:bg-gold-50"
            >
              <span className="truncate">{item.linkLabel?.trim() || "Подробнее"}</span>
              <ArrowRightIcon className="h-3.5 w-3.5 shrink-0" />
            </a>
          </div>
        )}
      </div>
    </div>
  );

  // Портал в body — обязателен, а не «для чистоты». Окно живёт внутри
  // хиро, у которого свой слой (z-20), и z-[100] считается ВНУТРИ него:
  // подняться выше шапки (z-50) оно не могло, из-за чего крестик
  // оказывался под шапкой и не нажимался. В body слоёв-предков нет.
  return createPortal(overlay, document.body);
}
