"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type PhotoCarouselProps = {
  images: string[];
  alt: string;
  intervalMs?: number;
};

/** Плавная кроссфейд-карусель шапки статьи. Пауза при наведении и
 *  уважение prefers-reduced-motion — автопрокрутка просто не включается. */
export function PhotoCarousel({ images, alt, intervalMs = 4500 }: PhotoCarouselProps) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (images.length <= 1 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = window.setInterval(() => {
      setActive((prev) => (prev + 1) % images.length);
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [images.length, paused, intervalMs]);

  if (images.length === 0) return null;

  return (
    <div
      className="relative h-full w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {images.map((src, index) => (
        <Image
          key={src}
          src={src}
          alt={alt}
          fill
          priority={index === 0}
          sizes="(min-width: 768px) 700px, 100vw"
          className={`object-cover transition-opacity duration-1000 ease-in-out ${
            index === active ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}

      {images.length > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
          {images.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`Показать фото ${index + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                index === active ? "w-5 bg-white" : "w-1.5 bg-white/50"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
