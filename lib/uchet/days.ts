// Дни строками «2026-10-21» — день по Симферополю. Сводка и зарплата
// считают по дням, и арифметика над такими строками проще и честнее, чем
// над Date с часовыми поясами.

const DAY = 86_400_000;

const toMs = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (day: string, n: number) => fromMs(toMs(day) + n * DAY);

/** Сколько дней в отрезке, оба конца включительно. */
export const daysIn = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY) + 1;

/** «2026-10» → «2026-11». */
export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** «2026-10» → «2026-09». */
export function prevMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Последний день месяца: «2026-02» → «2026-02-28». */
export const monthEnd = (month: string) => addDays(`${nextMonth(month)}-01`, -1);

const studioDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" });

/** Метка времени → день по Симферополю. */
export const studioDay = (iso: string) => studioDayFmt.format(new Date(iso));

/** Все дни отрезка по порядку. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
