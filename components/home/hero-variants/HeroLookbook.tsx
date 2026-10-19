import Image from "next/image";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import { getHeroPhotos, formatPrice } from "@/components/home/hero-variants/heroProducts";

// ================================================================
// Вариант Б — «Лукбук».
//
// Три настоящие работы студии в разнобой по высоте. Смысл в том, что
// первый экран показывает не одну картинку, а почерк: видно, что букеты
// собирают в одном стиле и что их много. Для студии без громкого имени
// это убедительнее любого слогана.
//
// Высоты и сдвиги заданы руками, а не поровну: ровный ряд из трёх
// одинаковых прямоугольников читается как таблица товаров, а не как
// витрина.
// ================================================================

/** Сдвиг и пропорции каждой карточки — чтобы ряд не выглядел таблицей. */
const FRAMES = [
  "aspect-[3/4] lg:mt-10",
  "aspect-[3/5]",
  "aspect-[3/4] lg:mt-16",
];

export async function HeroLookbook() {
  const photos = await getHeroPhotos(3);

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,40%)_1fr] lg:gap-12 lg:px-8 lg:pt-20">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 font-display text-[11px] font-semibold uppercase tracking-widest text-gold-700 ring-1 ring-gold-400/30 sm:text-xs">
            Цветочная студия · Симферополь
          </span>

          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.08] text-ink sm:text-5xl">
            Собираем
            <br />
            <span className="text-gold-700">под повод</span>
            <br />и под человека
          </h1>

          <p className="mt-5 max-w-sm font-body text-base leading-relaxed text-ink/70">
            Расскажите, кому и зачем — предложим три варианта и пришлём фото
            готового букета до того, как курьер выедет.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <TrackedLink
              href="/catalog"
              eventTarget="Смотреть работы (лукбук)"
              className="group inline-flex items-center gap-2 rounded-full bg-lavender-600 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-lavender-700"
            >
              Смотреть работы
              <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </TrackedLink>
            <TrackedLink
              href="/contacts"
              eventTarget="Написать флористу (лукбук)"
              className="font-display text-sm font-medium text-ink/70 underline decoration-lavender-300 decoration-2 underline-offset-4 transition hover:text-ink"
            >
              Написать флористу
            </TrackedLink>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {photos.map((photo, i) => (
            <TrackedLink
              key={photo.slug}
              href={`/catalog/${photo.slug}`}
              eventTarget="Фото в шапке (лукбук)"
              className={`group relative block overflow-hidden rounded-2xl bg-lavender-100 shadow-lg ring-1 ring-black/5 ${FRAMES[i] ?? FRAMES[0]}`}
            >
              <Image
                src={photo.src}
                alt={photo.name}
                fill
                priority={i === 0}
                sizes="(min-width: 1024px) 280px, 31vw"
                className="object-cover transition duration-700 group-hover:scale-[1.04]"
              />
              <div
                className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent opacity-0 transition group-hover:opacity-100"
                aria-hidden="true"
              />
              <span className="absolute bottom-3 left-3 right-3 font-display text-xs font-semibold text-white opacity-0 drop-shadow transition group-hover:opacity-100">
                {formatPrice(photo.price)}
              </span>
            </TrackedLink>
          ))}
        </div>
      </div>
    </section>
  );
}
