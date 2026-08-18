"use client";

import { useState } from "react";
import type { Story } from "@/lib/stories";
import { StoryViewer } from "@/components/home/StoryViewer";

export function StoriesRailClient({ stories }: { stories: Story[] }) {
  const [open, setOpen] = useState<{ storyIndex: number; itemIndex: number } | null>(null);

  return (
    <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {stories.map((story, index) => (
          <button
            key={story.id}
            type="button"
            onClick={() => setOpen({ storyIndex: index, itemIndex: 0 })}
            className="group flex shrink-0 flex-col items-center gap-2"
          >
            <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold-400 via-gold-500 to-lavender-500 p-[3px] transition group-hover:scale-105 sm:h-20 sm:w-20">
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-white p-[3px]">
                {story.coverImage ? (
                  <img
                    src={story.coverImage}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span className="h-full w-full rounded-full bg-lavender-100" />
                )}
              </span>
            </span>
            <span className="max-w-[76px] truncate font-body text-xs text-ink/70">{story.title}</span>
          </button>
        ))}
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
