import { existsSync } from "fs";
import { join } from "path";
import Link from "next/link";
import { getCategories } from "@/lib/categories";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";

/**
 * Веточка в углу карточки — та же техника, что у боковой ботаники в хиро:
 * рисунок работает маской, цвет даёт градиент под ней (см. globals.css,
 * .botanical-accent-fill). Пока файла нет — угол просто пустой.
 */
const CARD_ART = "/botanical-card.svg";
const CARD_ART_FALLBACK = "/botanical-card.png";

function resolveCardArt(): string | null {
  for (const candidate of [CARD_ART, CARD_ART_FALLBACK]) {
    if (existsSync(join(process.cwd(), "public", candidate))) return candidate;
  }
  return null;
}

export async function CategoryGrid() {
  const categories = await getCategories();
  if (categories.length === 0) return null;

  const cardArt = resolveCardArt();

  return (
    // Фон общий для всей главной (.home-canvas), поэтому секция прозрачная —
    // свой градиент здесь давал бы шов на стыке с хиро.
    <section className="relative">
      <div className="relative z-10 mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
        <div className="mb-6 sm:mb-10 lg:mb-14">
          <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 font-display text-[11px] font-semibold uppercase tracking-widest text-gold-700 ring-1 ring-gold-400/30 sm:px-4 sm:py-1.5 sm:text-xs">
            Цветы и подарки
          </span>
          <h2 className="mt-3 font-display text-2xl font-bold text-ink sm:mt-4 sm:text-3xl lg:text-4xl">
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
              // Золотая обводка убрана: рядом с градиентным фоном она резала
              // карточку рамкой и спорила с золотом в тексте. Форму теперь
              // держат мягкая тень и белая заливка — карточка «лежит» на фоне,
              // а не вырезана из него.
              className="group relative flex min-h-[124px] items-stretch overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_-16px_rgba(94,74,150,0.45)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-18px_rgba(94,74,150,0.55)] sm:min-h-[152px] lg:min-h-[172px]"
            >
              {/* Фото — слева на всех размерах, чтобы карточка оставалась компактной по высоте на мобильном */}
              <div className="relative w-[38%] shrink-0 overflow-hidden sm:w-[42%]">
                {category.image ? (
                  // Внешние URL из Supabase Storage — next/image потребовал бы
                  // настройки remotePatterns, обычный img проще для контента админки
                  <img
                    src={category.image}
                    alt={category.title}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                ) : (
                  <PhotoPlaceholder className="absolute inset-0 h-full w-full" />
                )}
              </div>

              {/* Текст — справа, по центру по вертикали и горизонтали, как на макете */}
              <div className="relative flex flex-1 items-center justify-center px-3 text-center sm:px-6">
                <h3 className="relative z-10 font-display text-sm font-bold uppercase leading-snug tracking-wide text-ink sm:text-base lg:text-lg">
                  {category.title}
                </h3>

                {cardArt && (
                  <span
                    aria-hidden="true"
                    className="botanical-accent pointer-events-none absolute bottom-2 right-2 h-14 w-14 sm:h-16 sm:w-16"
                  >
                    <span
                      className="botanical-accent-fill block h-full w-full"
                      style={{
                        WebkitMaskImage: `url(${cardArt})`,
                        maskImage: `url(${cardArt})`,
                        WebkitMaskRepeat: "no-repeat",
                        maskRepeat: "no-repeat",
                        WebkitMaskSize: "contain",
                        maskSize: "contain",
                        WebkitMaskPosition: "bottom right",
                        maskPosition: "bottom right",
                      }}
                    />
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
