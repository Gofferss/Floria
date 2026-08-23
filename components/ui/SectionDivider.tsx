import { existsSync } from "fs";
import { join } from "path";

// ================================================================
// Разделитель между блоками главной: тонкая линия, растворяющаяся к
// краям, с ботаническим знаком по центру.
//
// Знак необязателен. Пока файла нет, линия просто идёт сплошной — это
// само по себе законченный вариант, а не «недоделка». Появится графика —
// линия разомкнётся и пропустит знак в середину, без правок кода.
//
// Знак заливается тем же градиентом, что боковая ботаника
// (.botanical-accent-fill в globals.css), но статично: у разделителя нет
// состояния наведения, он не интерактивен и не должен приглашать к клику.
// ================================================================

const MARK = "/botanical-divider.svg";
const MARK_FALLBACK = "/botanical-divider.png";

function resolveMark(): string | null {
  for (const candidate of [MARK, MARK_FALLBACK]) {
    if (existsSync(join(process.cwd(), "public", candidate))) return candidate;
  }
  return null;
}

/** Волосяная линия, уходящая в прозрачность к внешнему краю. */
function Line({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden="true"
      className="h-px flex-1"
      style={{
        backgroundImage:
          side === "left"
            ? "linear-gradient(to right, transparent, rgba(186,155,18,0.45), rgba(155,127,209,0.55))"
            : "linear-gradient(to left, transparent, rgba(186,155,18,0.45), rgba(155,127,209,0.55))",
      }}
    />
  );
}

export function SectionDivider() {
  const mark = resolveMark();

  // Без знака — одна сплошная линия, симметрично растворяющаяся к обоим
  // краям. Двумя половинками с зазором посередине было бы хуже: пустой
  // разрыв читается как отсутствующая картинка, а не как приём.
  if (!mark) {
    return (
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-2 sm:px-6 sm:py-4">
        <span
          aria-hidden="true"
          className="block h-px w-full"
          style={{
            backgroundImage:
              "linear-gradient(to right, transparent, rgba(186,155,18,0.45), rgba(155,127,209,0.55), rgba(186,155,18,0.45), transparent)",
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative z-10 mx-auto flex max-w-3xl items-center gap-4 px-4 py-2 sm:px-6 sm:py-4">
      <Line side="left" />

      <span
          aria-hidden="true"
          className="botanical-accent-fill h-8 w-8 shrink-0 sm:h-10 sm:w-10"
          style={{
            WebkitMaskImage: `url(${mark})`,
            maskImage: `url(${mark})`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
      />

      <Line side="right" />
    </div>
  );
}
