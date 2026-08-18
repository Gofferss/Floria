// ================================================================
// Разбор даты из свободного текста вроде "У моей жены день рождение
// 17.08" или "Годовщина 5 марта". Напоминание ежегодное — год из
// текста (если есть) намеренно игнорируется, важны только день/месяц.
// ================================================================

const MONTH_GENITIVE: Record<string, number> = {
  "января": 1,
  "февраля": 2,
  "марта": 3,
  "апреля": 4,
  "мая": 5,
  "июня": 6,
  "июля": 7,
  "августа": 8,
  "сентября": 9,
  "октября": 10,
  "ноября": 11,
  "декабря": 12,
};

const MONTH_DISPLAY = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export type ParsedDate = { day: number; month: number };

function isValidDayMonth(day: number, month: number): boolean {
  if (month < 1 || month > 12) return false;
  // 29 для февраля — намеренно разрешаем (29 февраля как ежегодная дата,
  // раз в 4 года), см. nextOccurrence в lib/telegram/reminders.ts, где
  // это сводится к 28-му в невисокосный год.
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

export function parseReminderDate(text: string): ParsedDate | null {
  const normalized = text.toLowerCase();

  // "17 августа"
  const monthNames = Object.keys(MONTH_GENITIVE).join("|");
  const namedMatch = normalized.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})\\b`, "u"));
  if (namedMatch) {
    const day = Number(namedMatch[1]);
    const month = MONTH_GENITIVE[namedMatch[2]];
    if (isValidDayMonth(day, month)) return { day, month };
  }

  // "17.08", "17/08", "17.08.2026" (год игнорируется)
  const numericMatch = normalized.match(/\b(\d{1,2})[.\/](\d{1,2})(?:[.\/]\d{2,4})?\b/);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    if (isValidDayMonth(day, month)) return { day, month };
  }

  return null;
}

export function formatDayMonth(day: number, month: number): string {
  return `${day} ${MONTH_DISPLAY[month - 1]}`;
}
