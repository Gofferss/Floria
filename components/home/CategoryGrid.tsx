import Image from "next/image";
import Link from "next/link";
import { categories } from "@/lib/mock-data";

export function CategoryGrid() {
  return (
    <section className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
      <div className="mb-6 sm:mb-10 lg:mb-14">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Цветы и подарки
        </span>
        <h2 className="mt-1.5 font-display text-2xl font-bold text-ink sm:mt-2 sm:text-3xl lg:text-4xl">
          Выберите повод
        </h2>
      </div>

      {/* 1 колонка на мобильном (компактные широкие карточки), 2×2 от sm и на десктопе —
          именно под layout "фото слева / текст справа" из макета: в 4 колонки такие
          карточки были бы слишком узкими для фото рядом с текстом. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        {categories.map((category) => (
          <Link
            key={category.slug}
            href={`/catalog?category=${category.slug}`}
            className="group flex min-h-[124px] items-stretch overflow-hidden rounded-2xl border border-gold-400/60 bg-white transition hover:-translate-y-0.5 hover:border-gold-500 hover:shadow-lg sm:min-h-[152px] lg:min-h-[172px]"
          >
            {/* Фото — слева на всех размерах, чтобы карточка оставалась компактной по высоте на мобильном */}
            <div className="relative w-[38%] shrink-0 sm:w-[42%]">
              <Image
                src={category.image}
                alt={category.title}
                fill
                sizes="(min-width: 1024px) 280px, (min-width: 640px) 240px, 40vw"
                className="object-cover"
              />
            </div>

            {/* Текст — справа, по центру по вертикали и горизонтали, как на макете */}
            <div className="flex flex-1 items-center justify-center px-3 text-center sm:px-6">
              <h3 className="font-display text-sm font-bold uppercase leading-snug tracking-wide text-ink sm:text-base lg:text-lg">
                {category.title}
              </h3>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
