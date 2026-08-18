import { existsSync } from "fs";
import { join } from "path";
import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { HeroBackdrop, type PhotoAccent } from "@/components/home/HeroBackdrop";
import { HeroBouquetPhoto } from "@/components/home/HeroBouquetPhoto";

const BOUQUET_PHOTO = "/hero-bouquet-summer.png";

const PHOTO_ACCENTS: PhotoAccent[] = [
  { src: "/flower-rose.png", alt: "", top: "6%", left: "7%", size: "w-24 sm:w-32 lg:w-40", depth: 18, delay: "0s", rotate: -6, anim: "motion-safe:animate-float-slow" },
  { src: "/flower-tulip.png", alt: "", top: "68%", left: "3%", size: "w-16 sm:w-20 lg:w-24", depth: 24, delay: "1.4s", rotate: 10, anim: "motion-safe:animate-float-fast" },
  { src: "/flower-potted.png", alt: "", top: "6%", left: "80%", size: "w-24 sm:w-28 lg:w-32", depth: 20, delay: "0.7s", rotate: 5, anim: "motion-safe:animate-float-slow" },
];

/**
 * Проверяем на сервере, что файл реально лежит в /public, а не полагаемся
 * на onError в браузере: тот срабатывает по нативному событию "error",
 * которое у уже отрендеренной серверной HTML-разметки почти всегда
 * происходит РАНЬШЕ, чем React успевает гидрироваться и повесить
 * обработчик — в деве это стабильно ловится как гонка, битая картинка
 * успевает мелькнуть. Так деталей просто нет в разметке, пока файла нет.
 */
function fileExists(publicPath: string): boolean {
  return existsSync(join(process.cwd(), "public", publicPath));
}

export function Hero() {
  const bouquetExists = fileExists(BOUQUET_PHOTO);
  const availableAccents = PHOTO_ACCENTS.filter((accent) => fileExists(accent.src));

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-lavender-100 via-lavender-50 to-white">
      <HeroBackdrop accents={availableAccents} />

      {/* Боковые паттерны с левитацией. Показываем только от xl (1280px) —
          при max-w-7xl (тоже 1280px) именно с этой ширины у секции
          появляется реальное свободное поле по краям. Только прозрачность,
          без градиентной растушёвки — она давала резкий светлый край. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-28 opacity-20 motion-safe:animate-float-slow xl:block 2xl:w-48"
        aria-hidden="true"
      >
        <Image src="/pattern-left.png" alt="" fill className="object-cover object-left" />
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-28 opacity-20 motion-safe:animate-float-fast motion-safe:[animation-delay:0.6s] xl:block 2xl:w-48"
        aria-hidden="true"
      >
        <Image src="/pattern-right.png" alt="" fill className="object-cover object-right" />
      </div>

      <div className="relative z-20 mx-auto grid max-w-7xl grid-cols-1 items-center gap-8 px-4 py-10 sm:gap-12 sm:px-6 sm:py-14 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
        {/* Текстовый блок */}
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 font-display text-[11px] font-semibold uppercase tracking-widest text-gold-700 ring-1 ring-gold-400/30 sm:px-4 sm:py-1.5 sm:text-xs">
            Цветочная студия в Симферополе
          </span>

          {/* Заголовок — золотисто-коричневый акцент, как на макете (не тёмный ink) */}
          <h1 className="mt-4 font-display text-3xl font-bold leading-[1.15] text-gold-700 sm:mt-6 sm:text-4xl lg:text-6xl">
            Floria — Студия цветов.
          </h1>
          <p className="mt-1.5 font-display text-lg italic text-gold-600 sm:mt-2 sm:text-2xl lg:text-3xl">
            Искусство в каждом букете
          </p>

          <p className="mt-3 max-w-md font-body text-sm leading-relaxed text-ink/70 sm:mt-6 sm:text-base">
            Собираем авторские букеты из свежей срезки, доставляем по
            Симферополю день в день и напоминаем о важных датах — так, чтобы
            каждый повод был особенным.
          </p>

          {/* Кнопка — фиолетовая (акцентный цвет бренда), а не золотая:
              на этой странице золото уже занято текстом и рамками карточек,
              фиолетовый даёт кнопке visually отдельную роль основного CTA. */}
          <div className="mt-5 flex flex-wrap items-center gap-3 sm:mt-8 sm:gap-4">
            <Link
              href="/catalog"
              className="group inline-flex items-center gap-2 rounded-full bg-lavender-600 px-6 py-3 font-display text-xs font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-lavender-700 sm:px-8 sm:py-4 sm:text-sm"
            >
              Подобрать букет
              <ArrowRightIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 sm:h-4 sm:w-4" />
            </Link>
            <Link
              href="/catalog"
              className="font-display text-xs font-medium text-ink/70 underline decoration-lavender-300 decoration-2 underline-offset-4 transition hover:text-ink sm:text-sm"
            >
              Смотреть каталог
            </Link>
          </div>
        </div>

        {bouquetExists && <HeroBouquetPhoto src={BOUQUET_PHOTO} />}
      </div>
    </section>
  );
}
