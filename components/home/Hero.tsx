import { existsSync } from "fs";
import { join } from "path";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { HeroBackdrop } from "@/components/home/HeroBackdrop";
import { HeroBotanicals } from "@/components/home/HeroBotanicals";
import { HeroBouquetPhoto } from "@/components/home/HeroBouquetPhoto";
import { StoriesRail } from "@/components/home/StoriesRail";
import { TrackedLink } from "@/components/analytics/TrackedLink";

const BOUQUET_PHOTO = "/hero-bouquet-summer.png";

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

  return (
    <section className="relative overflow-hidden">
      <HeroBackdrop />

      <HeroBotanicals />

      <div className="relative z-20 mx-auto grid max-w-7xl grid-cols-1 items-center gap-8 px-4 pt-10 sm:gap-12 sm:px-6 sm:pt-14 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:pt-24">
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
            <TrackedLink
              href="/catalog"
              eventTarget="Подобрать букет (hero)"
              className="group inline-flex items-center gap-2 rounded-full bg-lavender-600 px-6 py-3 font-display text-xs font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-lavender-700 sm:px-8 sm:py-4 sm:text-sm"
            >
              Подобрать букет
              <ArrowRightIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 sm:h-4 sm:w-4" />
            </TrackedLink>
            <TrackedLink
              href="/catalog"
              eventTarget="Смотреть каталог (hero)"
              className="font-display text-xs font-medium text-ink/70 underline decoration-lavender-300 decoration-2 underline-offset-4 transition hover:text-ink sm:text-sm"
            >
              Смотреть каталог
            </TrackedLink>
          </div>
        </div>

        {bouquetExists && <HeroBouquetPhoto src={BOUQUET_PHOTO} />}
      </div>

      {/* Истории — нижняя строка хиро-блока. Сетка выше двухколоночная, а
          ряд кружков должен идти во всю ширину, поэтому он вынесен из неё. */}
      <div className="relative z-20 mx-auto max-w-7xl px-4 pb-10 sm:px-6 sm:pb-14 lg:px-8 lg:pb-16">
        <StoriesRail />
      </div>
    </section>
  );
}
