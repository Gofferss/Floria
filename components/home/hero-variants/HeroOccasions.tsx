import Image from "next/image";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import { getCategories } from "@/lib/categories";
import { getHeroPhotos } from "@/components/home/hero-variants/heroProducts";

// ================================================================
// Вариант В — «С чем пришли».
//
// Самый практичный из трёх и наименее декоративный. Человек приходит за
// цветами не «посмотреть студию», а с поводом: день рождения, свадьба,
// извиниться. Этот блок спрашивает про повод сразу и уводит в уже
// отфильтрованный каталог — вместо того чтобы показать красивое фото и
// оставить гостя самому искать нужное.
//
// Карточки берут и название, и картинку из настоящих категорий каталога:
// если категорию переименуют или скроют, блок не соврёт.
// ================================================================

/** Сколько поводов показываем. Больше четырёх — уже не выбор, а список. */
const SHOWN = 4;

export async function HeroOccasions() {
  const [categories, photos] = await Promise.all([getCategories(), getHeroPhotos(SHOWN)]);
  const cards = categories.slice(0, SHOWN);

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 sm:pt-14 lg:px-8 lg:pt-20">
        <div className="animate-fade-up mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 font-display text-[11px] font-semibold uppercase tracking-widest text-gold-700 ring-1 ring-gold-400/30 sm:text-xs">
            Доставка по Симферополю от 2 часов
          </span>

          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.08] text-ink sm:text-5xl lg:text-6xl">
            Цветы для тех,
            <br />
            <span className="text-gold-700">кому их ждут</span>
          </h1>

          <p className="mx-auto mt-5 max-w-lg font-body text-base leading-relaxed text-ink/70">
            Авторская сборка из свежей срезки. Выберите повод — покажем, что
            соберём, и пришлём фото букета до отправки.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
            <TrackedLink
              href="/catalog"
              eventTarget="Весь каталог (поводы)"
              className="group inline-flex items-center gap-2 rounded-full bg-lavender-600 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-lavender-700"
            >
              Весь каталог
              <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </TrackedLink>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {cards.map((category, i) => {
            // У категории может быть своя обложка — она точнее товарного
            // фото. Снимок из каталога только подстраховывает пустую.
            const art = category.image ?? photos[i]?.src;
            return (
              <TrackedLink
                key={category.slug}
                href={`/catalog?category=${category.slug}`}
                eventTarget={`Повод: ${category.title}`}
                className="group relative block aspect-[4/5] overflow-hidden rounded-2xl bg-lavender-100 shadow-lg ring-1 ring-black/5"
              >
                {art && (
                  <Image
                    src={art}
                    alt=""
                    fill
                    priority={i < 2}
                    sizes="(min-width: 1024px) 300px, 46vw"
                    className="object-cover transition duration-700 group-hover:scale-[1.04]"
                  />
                )}
                {/* Плашка идёт на всю карточку, а не только под подпись:
                    фотографии разные по светлоте, и локальная подложка на
                    светлом снимке проступала бы грязным пятном. */}
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent"
                  aria-hidden="true"
                />
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-4 font-display text-sm font-semibold text-white drop-shadow">
                  {category.title}
                  <ArrowRightIcon className="h-4 w-4 shrink-0 opacity-0 transition group-hover:opacity-100" />
                </span>
              </TrackedLink>
            );
          })}
        </div>
      </div>
    </section>
  );
}
