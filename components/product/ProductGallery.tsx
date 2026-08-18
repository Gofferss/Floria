"use client";

import { useState } from "react";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";

type ProductGalleryProps = {
  images: string[];
  productName: string;
};

export function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [active, setActive] = useState(0);
  const activeImage = images[active];

  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-gradient-to-br from-lavender-200 via-lavender-100 to-white">
        {activeImage ? (
          // Внешние URL из Supabase Storage — next/image потребовал бы
          // настройки remotePatterns, обычный img проще для контента админки
          <img src={activeImage} alt={productName} className="h-full w-full object-cover" />
        ) : (
          <PhotoPlaceholder className="absolute inset-0 h-full w-full" />
        )}
      </div>

      {images.length > 1 && (
        <div className="mt-4 grid grid-cols-4 gap-3">
          {images.map((image, index) => (
            <button
              key={image}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`Фото ${index + 1} товара «${productName}»`}
              aria-current={active === index}
              className={`relative aspect-square overflow-hidden rounded-2xl ring-2 transition ${
                active === index ? "ring-gold-500" : "ring-transparent hover:ring-lavender-300"
              }`}
            >
              <img src={image} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
