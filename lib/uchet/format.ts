// ================================================================
// Подписи и форматирование склада. Без серверных зависимостей — модуль
// используется и на сервере, и в браузере.
// ================================================================

export type DocType = "opening" | "receipt" | "writeoff" | "inventory";
export type DocStatus = "draft" | "posted" | "reversed";
export type GroupKind =
  | "flower"
  | "greenery"
  | "decor"
  | "packaging"
  | "gift"
  | "print"
  | "service"
  | "bouquet"
  | "other";
export type PaymentMethod = "cash" | "card" | "transfer" | "unpaid" | "other";

export const DOC_TYPES: DocType[] = ["receipt", "writeoff", "inventory", "opening"];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  receipt: "Приход",
  writeoff: "Списание",
  inventory: "Инвентаризация",
  opening: "Начальный остаток",
};

/** Что делает документ — для подсказки на форме. */
export const DOC_TYPE_HINT: Record<DocType, string> = {
  receipt: "Привезли товар. Указываете, сколько и по какой цене купили, — остаток растёт, себестоимость пересчитывается.",
  writeoff: "Товар ушёл не в продажу: завял, сломался, на нужды. Остаток уменьшается по текущей себестоимости.",
  inventory: "Пересчитали руками. Вводите, сколько насчитали, — система сама запишет разницу с учётом.",
  opening: "Остаток на день начала учёта. Делается один раз, после пересчёта.",
};

export const STATUS_LABEL: Record<DocStatus, string> = {
  draft: "Черновик",
  posted: "Проведён",
  reversed: "Сторнирован",
};

export const KIND_LABEL: Record<GroupKind, string> = {
  flower: "Цветы",
  greenery: "Зелень",
  decor: "Декор, сухоцветы",
  packaging: "Упаковка",
  gift: "Подарки",
  print: "Открытки, полиграфия",
  service: "Услуги",
  bouquet: "Букеты по цене",
  other: "Прочее",
};

export const KINDS = Object.keys(KIND_LABEL) as GroupKind[];

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "Наличными из кассы",
  card: "Картой",
  transfer: "Переводом",
  unpaid: "Не оплачено (в долг)",
  other: "Другое",
};

export const PAYMENT_METHODS = Object.keys(PAYMENT_LABEL) as PaymentMethod[];

const qtyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const moneyFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** «12», «3,5», «−8». Знак минуса — типографский, чтобы не терялся в таблице. */
export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return qtyFormatter.format(value).replace("-", "−");
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${moneyFormatter.format(value).replace("-", "−")} ₽`;
}

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Simferopol",
});
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Simferopol",
});

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFormatter.format(new Date(iso)) : "—";
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFormatter.format(new Date(iso)) : "—";
}

/** Сколько полных дней прошло — для «двигалась 3 дня назад». */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function daysLabel(days: number | null): string {
  if (days === null) return "никогда";
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  const last = days % 10;
  const tens = days % 100;
  const word =
    last === 1 && tens !== 11 ? "день" : last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? "дня" : "дней";
  return `${days} ${word} назад`;
}
