import { studioNow } from "@/lib/checkout";

// ================================================================
// Сезон букета (миграция 038): в какие месяцы показывать его на сайте.
//
// null — весь год. Вне своих месяцев букет сам исчезает из каталога,
// поиска и с главной, а по прямой ссылке открывается с пояснением и без
// кнопки заказа. Месяц считаем по часам студии: сервер живёт в UTC, и в
// ночь на первое число витрина сменилась бы на три часа позже.
// ================================================================

export const MONTH_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

/** Для фразы «вернётся в мае». */
const MONTH_IN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];

export const SEASON_PRESETS: { label: string; months: number[] }[] = [
  { label: "Весна", months: [3, 4, 5] },
  { label: "Лето", months: [6, 7, 8] },
  { label: "Осень", months: [9, 10, 11] },
  { label: "Зима", months: [12, 1, 2] },
];

export function currentStudioMonth(now: Date = new Date()): number {
  return studioNow(now).getUTCMonth() + 1;
}

/** Порядок и повторы не важны; «все двенадцать» и «ни одного» — это весь год. */
export function normalizeSeasonMonths(months: readonly number[] | null | undefined): number[] | null {
  if (!months) return null;
  const clean = [...new Set(months.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b);
  return clean.length === 0 || clean.length === 12 ? null : clean;
}

export function isInSeason(months: readonly number[] | null | undefined, month: number = currentStudioMonth()): boolean {
  return !months || months.length === 0 || months.includes(month);
}

/** Условие для запроса к витрине: сезона нет или текущий месяц в него входит. */
export function inSeasonFilter(month: number = currentStudioMonth()): string {
  return `season_months.is.null,season_months.cs.{${month}}`;
}

/** Следующий месяц сезона после текущего; null — букет виден круглый год. */
export function nextSeasonMonth(months: readonly number[] | null | undefined, month: number = currentStudioMonth()): number | null {
  if (!months || months.length === 0) return null;
  for (let step = 1; step <= 12; step++) {
    const candidate = ((month - 1 + step) % 12) + 1;
    if (months.includes(candidate)) return candidate;
  }
  return null;
}

/** «вернётся в мае» */
export function returnsInPhrase(months: readonly number[] | null | undefined, month: number = currentStudioMonth()): string | null {
  const next = nextSeasonMonth(months, month);
  return next ? `в ${MONTH_IN[next - 1]}` : null;
}

/** «Май–Июл» или «Дек–Фев, Июн» — для списка в админке. */
export function seasonSummary(months: readonly number[] | null | undefined): string {
  const set = normalizeSeasonMonths(months);
  if (!set) return "Весь год";
  // Начинаем с месяца после разрыва, чтобы зима не распалась на «Янв–Фев, Дек».
  const start = set.find((m) => !set.includes(m === 1 ? 12 : m - 1)) ?? set[0];
  const parts: string[] = [];
  let from: number | null = null;
  let prev = 0;
  for (let step = 0; step <= 12; step++) {
    const m = ((start - 1 + step) % 12) + 1;
    if (step < 12 && set.includes(m)) {
      if (from === null) from = m;
      prev = m;
    } else if (from !== null) {
      parts.push(from === prev ? MONTH_SHORT[from - 1] : `${MONTH_SHORT[from - 1]}–${MONTH_SHORT[prev - 1]}`);
      from = null;
    }
  }
  return parts.join(", ");
}
