import Image from "next/image";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import { getHeroPhotos, formatPrice } from "@/components/home/hero-variants/heroProducts";

// ================================================================
// Вариант А — «Витрина».
//
// Одно большое фото во всю высоту блока, прижатое к правому краю. Главное
// отличие от прежнего блока: фото здесь — настоящая фотография в рамке
// кадра, а не вырезанный по контуру букет, висящий в воздухе. Вырезка
// требует идеального контура и всё равно читается как наклейка.
//
// Текст ужат до одного утверждения. В прежнем блоке подряд шли «цветочная
// студия в Симферополе», «Floria — Студия цветов» и «искусство в каждом
// букете» — три строки об одном, занимавшие весь первый экран.
// ================================================================

const PROMISES = [
  "Доставка по Симферополю от 2 часов",
  "Фото букета перед отправкой",
  "Собираем из свежей срезки",
];

export async function HeroShowcase() {
  const [photo] = await getHeroPhotos(1);

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[1fr_minmax(0,46%)] lg:gap-14 lg:px-8 lg:pt-20">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 font-display text-[11px] font-semibold uppercase tracking-widest text-gold-700 ring-1 ring-gold-400/30 sm:text-xs">
            Симферополь
          </span>

          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.08] text-ink sm:text-5xl lg:text-6xl">
            Букет, который
            <br />
            <span className="text-gold-700">не стыдно вручить</span>
          </h1>

          <p className="mt-5 max-w-md font-body text-base leading-relaxed text-ink/70">
            Авторская сборка из свежей срезки. Привезём сегодня — курьером по
            городу или заберёте сами из студии на Киевской.
          </p>

          <ul className="mt-6 space-y-2">
            {PROMISES.map((text) => (
              <li key={text} className="flex items-center gap-2.5 font-body text-sm text-ink/75">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <TrackedLink
              href="/catalog"
              eventTarget="Выбрать букет (витрина)"
              className="group inline-flex items-center gap-2 rounded-full bg-lavender-600 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-lavender-700"
            >
              Выбрать букет
              <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </TrackedLink>
            <TrackedLink
              href="/delivery"
              eventTarget="Условия доставки (витрина)"
              className="font-display text-sm font-medium text-ink/70 underline decoration-lavender-300 decoration-2 underline-offset-4 transition hover:text-ink"
            >
              Условия доставки
            </TrackedLink>
          </div>
        </div>

        {photo && (
          <TrackedLink
            href={`/catalog/${photo.slug}`}
            eventTarget="Фото в шапке (витрина)"
            className="group relative block"
          >
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[2rem] bg-lavender-100 shadow-xl ring-1 ring-black/5">
              <Image
                src={photo.src}
                alt={photo.name}
                fill
                priority
                sizes="(min-width: 1024px) 620px, 92vw"
                className="object-cover transition duration-700 group-hover:scale-[1.03]"
              />
              {/* Затемнение только у нижней кромки — чтобы подпись читалась
                  на любом фото, а не только на тёмном. */}
              <div
                className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/65 to-transparent"
                aria-hidden="true"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-6">
                <span className="font-display text-base font-semibold leading-snug text-white drop-shadow">
                  {photo.name}
                </span>
                <span className="shrink-0 rounded-full bg-white/95 px-4 py-1.5 font-display text-sm font-bold text-ink">
                  {formatPrice(photo.price)}
                </span>
              </div>
            </div>
          </TrackedLink>
        )}
      </div>
    </section>
  );
}
