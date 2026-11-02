import Image from "next/image";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { HeroBotanicals } from "@/components/home/HeroBotanicals";
import { StoriesRail } from "@/components/home/StoriesRail";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import { HeroShuffle } from "@/components/home/HeroShuffle";
import { getHeroPool, formatPrice } from "@/components/home/heroProducts";

// ================================================================
// Главный блок.
//
// Слева одно обещание, справа три настоящие работы студии. До этого здесь
// висел вырезанный по контуру букет на сиреневом градиенте, а текст трижды
// подряд повторял одно и то же: «цветочная студия в Симферополе»,
// «Floria — Студия цветов», «искусство в каждом букете». Весь первый экран
// уходил на представление вместо дела.
//
// Фотографии берутся из каталога и намеренно разной высоты. Ровный ряд из
// трёх одинаковых прямоугольников читается как таблица товаров, а не как
// витрина; вразнобой видно почерк — что букеты собирают в одном стиле и
// что их много. Для студии без громкого имени это убедительнее слогана.
//
// Букеты в окнах меняются при каждом заходе: в каждом окне лежит запас из
// своей части каталога, а показать один из них случайно выбирает браузер
// (HeroShuffle). Вернувшийся покупатель видит не ту же картинку, что
// вчера, а ещё одну работу студии.
// ================================================================

/** Что студия обещает. Три пункта: четвёртый уже никто не читает. */
const PROMISES = [
  "Доставка по Симферополю от 2 часов",
  "Фото букета перед отправкой",
  "Собираем из свежей срезки",
];

/**
 * Пропорции и сдвиг каждой карточки — чтобы ряд не выглядел таблицей.
 *
 * Разнобой включается только с широких экранов. На телефоне три карточки
 * и так по сто пикселей в ширину, и разная высота там читается не как
 * приём, а как съехавшая вёрстка — поэтому до lg все три одинаковые.
 */
const FRAMES = [
  "aspect-[3/4] lg:mt-10",
  "aspect-[3/4] lg:aspect-[3/5]",
  "aspect-[3/4] lg:mt-16",
];

/** Сколько букетов в запасе у каждого окна: 6³ — больше двухсот разных троек. */
const PER_SLOT = 6;

export async function Hero() {
  const pool = await getHeroPool(FRAMES.length, PER_SLOT);

  return (
    <section className="relative">
      <HeroBotanicals />

      <div className="relative z-20 mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,44%)_1fr] lg:gap-12 lg:px-8 lg:pt-20">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 font-display text-[11px] font-semibold uppercase tracking-widest text-gold-700 ring-1 ring-gold-400/30 sm:text-xs">
            Симферополь
          </span>

          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.08] text-ink sm:text-5xl">
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
              eventTarget="Выбрать букет (hero)"
              className="group inline-flex items-center gap-2 rounded-full bg-lavender-600 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-lavender-700"
            >
              Выбрать букет
              <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </TrackedLink>
            <TrackedLink
              href="/delivery"
              eventTarget="Условия доставки (hero)"
              className="font-display text-sm font-medium text-ink/70 underline decoration-lavender-300 decoration-2 underline-offset-4 transition hover:text-ink"
            >
              Условия доставки
            </TrackedLink>
          </div>
        </div>

        {pool.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {pool.map((candidates, i) => (
              <div key={i} data-hero-slot="" className={`relative ${FRAMES[i] ?? FRAMES[0]}`}>
                {candidates.map((photo, j) => (
                  // Какой букет открыть, решает HeroShuffle ещё до отрисовки,
                  // поэтому hidden в браузере может не совпасть с серверным.
                  <div
                    key={photo.slug}
                    data-hero-photo={photo.slug}
                    hidden={j > 0}
                    suppressHydrationWarning
                    className="absolute inset-0"
                  >
                    <TrackedLink
                      href={`/catalog/${photo.slug}`}
                      eventTarget="Фото в шапке"
                      className="group relative block h-full w-full overflow-hidden rounded-2xl bg-lavender-100 shadow-lg ring-1 ring-black/5"
                    >
                      {/* Без priority: заранее неизвестно, какое фото окажется
                          на экране, а предзагрузка всех восемнадцати съела бы
                          трафик. Ленивые картинки в видимой части экрана
                          браузер всё равно запрашивает сразу. */}
                      <Image
                        src={photo.src}
                        alt={photo.name}
                        fill
                        sizes="(min-width: 1024px) 300px, 31vw"
                        className="object-cover transition duration-700 group-hover:scale-[1.04]"
                      />
                      {/* Цена видна всегда, а не по наведению: на телефоне наведения
                          нет вовсе, и спрятанная туда цена просто не существует. */}
                      <div
                        className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent"
                        aria-hidden="true"
                      />
                      <span className="absolute bottom-2.5 left-3 right-3 font-display text-xs font-semibold text-white drop-shadow sm:text-sm">
                        {formatPrice(photo.price)}
                      </span>
                    </TrackedLink>
                  </div>
                ))}
              </div>
            ))}
            <HeroShuffle />
          </div>
        )}
      </div>

      {/* Истории — нижняя строка хиро-блока. Сетка выше двухколоночная, а
          ряд кружков должен идти во всю ширину, поэтому он вынесен из неё. */}
      <div className="relative z-20 mx-auto max-w-7xl px-4 pb-10 pt-10 sm:px-6 sm:pb-14 lg:px-8 lg:pb-16">
        <StoriesRail />
      </div>
    </section>
  );
}
