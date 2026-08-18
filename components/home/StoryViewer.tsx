"use client";

import { useEffect } from "react";
import type { Story } from "@/lib/stories";
import { CloseIcon } from "@/components/ui/Icons";

type StoryViewerProps = {
  stories: Story[];
  storyIndex: number;
  itemIndex: number;
  onNavigate: (storyIndex: number, itemIndex: number) => void;
  onClose: () => void;
};

export function StoryViewer({ stories, storyIndex, itemIndex, onNavigate, onClose }: StoryViewerProps) {
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/90 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={story.title}
    >
      <div
        className="relative aspect-[9/16] h-full max-h-[92vh] w-auto max-w-full overflow-hidden rounded-2xl bg-ink sm:h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={item.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />

        {/* Затемнение сверху — чтобы прогресс-бар и заголовок читались на любом фото */}
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink/60 to-transparent" aria-hidden="true" />

        {/* Прогресс-бар — сегмент на каждый слайд истории */}
        <div className="absolute inset-x-3 top-3 flex gap-1.5">
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

        <div className="absolute left-3 right-12 top-7 font-display text-sm font-semibold text-white drop-shadow">
          {story.title}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute right-3 top-6 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/50"
        >
          <CloseIcon className="h-4 w-4" />
        </button>

        {/* Клик по левой трети — назад, по остальному — вперёд */}
        <button
          type="button"
          onClick={() => goToItem(storyIndex, itemIndex - 1)}
          aria-label="Предыдущий слайд"
          className="absolute inset-y-0 left-0 w-1/3"
        />
        <button
          type="button"
          onClick={() => goToItem(storyIndex, itemIndex + 1)}
          aria-label="Следующий слайд"
          className="absolute inset-y-0 right-0 w-2/3"
        />
      </div>
    </div>
  );
}
