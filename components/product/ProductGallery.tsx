"use client";

import { useState } from "react";
import { BotanicalPattern } from "@/components/ui/BotanicalPattern";

const PLACEHOLDER_COUNT = 4;

export function ProductGallery({ productName }: { productName: string }) {
  const [active, setActive] = useState(0);

  return (
    <div>
      {/* Основное фото — заменить на next/image с реальной фотографией товара */}
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-gradient-to-br from-lavender-200 via-lavender-100 to-white">
        <BotanicalPattern
          className="absolute inset-0 h-full w-full text-white/80 transition-transform duration-500"
          style={{ transform: `rotate(${active * 6}deg) scale(1.05)` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        {Array.from({ length: PLACEHOLDER_COUNT }).map((_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setActive(index)}
            aria-label={`Фото ${index + 1} товара «${productName}»`}
            aria-current={active === index}
            className={`relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br from-lavender-200 to-lavender-50 ring-2 transition ${
              active === index ? "ring-gold-500" : "ring-transparent hover:ring-lavender-300"
            }`}
          >
            <BotanicalPattern className="absolute inset-0 h-full w-full text-white/70" />
          </button>
        ))}
      </div>
    </div>
  );
}
