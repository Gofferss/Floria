// Подписи сводки: даты периодов, короткие суммы для осей, проценты.
// Даты приходят строками «2026-10-21» (день по Симферополю), поэтому
// форматируем их как UTC — иначе часовой пояс браузера сдвинет день.

const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const dayMonthYear = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const weekdayDay = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" });

const asDate = (day: string) => new Date(`${day}T12:00:00Z`);

/** «21 октября», «21 октября 2025» — год, только если не текущий. */
export function fmtDay(day: string, currentYear?: string): string {
  return (currentYear && day.startsWith(currentYear) ? dayMonth : dayMonthYear).format(asDate(day)).replace(" г.", "");
}

/** «1–21 октября», «1 сентября – 21 октября», «21 октября». */
export function fmtRange(from: string, to: string, today: string): string {
  const year = today.slice(0, 4);
  if (from === to) return fmtDay(from, year);
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${Number(from.slice(8, 10))}–${fmtDay(to, year)}`;
  }
  return `${fmtDay(from, from.slice(0, 4) === to.slice(0, 4) ? to.slice(0, 4) : undefined)} – ${fmtDay(to, year)}`;
}

/** Подпись точки графика в подсказке. */
export function fmtPoint(day: string, step: "day" | "month"): string {
  if (step === "month") {
    const s = monthYear.format(asDate(day)).replace(" г.", "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const s = weekdayDay.format(asDate(day));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Короткая подпись месяца под столбиком: «апр». */
export function fmtMonthShort(day: string): string {
  return monthShort.format(asDate(day)).replace(".", "");
}

/** «73 тыс», «1,2 млн», «20 млн» — для осей и подсказок, где точность до рубля мешает. */
export function compactMoney(value: number): string {
  const v = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (v >= 1_000_000) {
    return `${sign}${(v / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн`;
  }
  if (v >= 1_000) return `${sign}${Math.round(v / 1_000).toLocaleString("ru-RU")} тыс`;
  return `${sign}${Math.round(v)}`;
}

/** «+5,2%», «−16,8%». */
export function fmtPct(value: number): string {
  const s = Math.abs(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${s}%`;
}

/** Деления оси: 0 и 2–4 «круглых» значения до максимума. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
