import { existsSync } from "fs";
import { join } from "path";

// ================================================================
// Контурная ботаника по краям хиро-блока.
//
// Ключевой приём: картинка НЕ вставляется тегом <img>, а работает маской
// (mask-image) для слоя, залитого градиентом. Что это даёт:
//
//   1. Цвет графики задаётся у нас, а не в файле. Один и тот же чёрный
//      контур становится золотым, лавандовым — любым.
//   2. Цвет можно ПЛАВНО менять при наведении, чего с обычной картинкой
//      не сделать: градиент под маской анимируется как обычный фон.
//   3. Работает и с SVG, и с PNG — лишь бы фон был прозрачным, а рисунок
//      непрозрачным. Прозрачность и есть форма маски.
//
// Файлов может не быть (графику меняем) — тогда компонент не рендерит
// ничего. Проверяем существование на сервере, как в Hero: полагаться на
// onError в браузере нельзя, битая картинка успевает мелькнуть.
// ================================================================

const LEFT_ART = "/botanical-left.svg";
const RIGHT_ART = "/botanical-right.svg";

/** Запасные имена: если положат PNG вместо SVG, тоже подхватим. */
const FALLBACKS: Record<string, string[]> = {
  [LEFT_ART]: ["/botanical-left.png"],
  [RIGHT_ART]: ["/botanical-right.png"],
};

function resolveArt(preferred: string): string | null {
  const candidates = [preferred, ...(FALLBACKS[preferred] ?? [])];
  for (const candidate of candidates) {
    if (existsSync(join(process.cwd(), "public", candidate))) return candidate;
  }
  return null;
}

function Botanical({ src, side }: { src: string; side: "left" | "right" }) {
  const mask: React.CSSProperties = {
    WebkitMaskImage: `url(${src})`,
    maskImage: `url(${src})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskPosition: side === "left" ? "left center" : "right center",
    maskPosition: side === "left" ? "left center" : "right center",
  };

  return (
    <div
      aria-hidden="true"
      className={`botanical-accent pointer-events-auto absolute inset-y-0 ${
        side === "left" ? "left-0" : "right-0"
      } z-10 hidden w-32 lg:block xl:w-44 2xl:w-56`}
    >
      <div className="botanical-accent-fill h-full w-full" style={mask} />
    </div>
  );
}

/**
 * pointer-events-auto на обёртке — сознательно: наведение должно работать,
 * а по умолчанию декоративные слои в хиро отключены для мыши, чтобы не
 * перехватывать клики по кнопкам. Здесь слой узкий и прижат к краю, кнопок
 * под ним нет.
 */
export function HeroBotanicals() {
  const left = resolveArt(LEFT_ART);
  const right = resolveArt(RIGHT_ART);

  if (!left && !right) return null;

  return (
    <>
      {left && <Botanical src={left} side="left" />}
      {right && <Botanical src={right} side="right" />}
    </>
  );
}
