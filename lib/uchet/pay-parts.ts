import { formatMoney } from "@/lib/uchet/format";

// Части схемы оплаты и их подписи. Без обращения к базе — нужны и
// серверу (расчёт), и экрану (редактор схемы).

export type PayKind = "monthly" | "per_shift" | "sales_percent" | "per_bouquet" | "per_delivery";
export type SalesBase = "own" | "shift_days" | "store";

export type PayPart = { kind: PayKind; amount: number | null; percent: number | null; base: SalesBase | null };

export const PAY_KINDS: { kind: PayKind; label: string; hint: string }[] = [
  { kind: "monthly", label: "Оклад в месяц", hint: "Одна сумма за месяц. Если схема сменилась в середине месяца — по дням." },
  { kind: "per_shift", label: "За смену", hint: "За каждый отработанный день по табелю." },
  { kind: "sales_percent", label: "Процент от продаж", hint: "Своих продаж, продаж точки в его дни или всех продаж точки." },
  { kind: "per_bouquet", label: "За букет", hint: "За каждый собранный букет — считает Учёт, после запуска." },
  { kind: "per_delivery", label: "За доставку", hint: "За каждую доставку курьера — считает Учёт, после запуска." },
];

export const SALES_BASES: { base: SalesBase; label: string }[] = [
  { base: "own", label: "своих продаж" },
  { base: "shift_days", label: "продаж точки в его дни" },
  { base: "store", label: "всех продаж точки" },
];

const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;

/** «Оклад 50 000 ₽», «5% своих продаж», «5 500 ₽ за смену». */
export function describePart(p: PayPart): string {
  switch (p.kind) {
    case "monthly":
      return `Оклад ${formatMoney(p.amount ?? 0)}`;
    case "per_shift":
      return `${formatMoney(p.amount ?? 0)} за смену`;
    case "sales_percent":
      return `${pct(p.percent ?? 0)} ${SALES_BASES.find((b) => b.base === p.base)?.label ?? "продаж"}`;
    case "per_bouquet":
      return `${formatMoney(p.amount ?? 0)} за букет`;
    case "per_delivery":
      return `${formatMoney(p.amount ?? 0)} за доставку`;
  }
}

export function describeScheme(parts: PayPart[]): string {
  return parts.length ? parts.map(describePart).join(" + ") : "схема не задана";
}

export const PAYOUT_METHODS: { method: "cash" | "card" | "transfer" | "other"; label: string }[] = [
  { method: "cash", label: "Наличными" },
  { method: "card", label: "На карту" },
  { method: "transfer", label: "Переводом" },
  { method: "other", label: "Другое" },
];
