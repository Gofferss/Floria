import { getSupabaseAdmin } from "@/lib/supabase";
import { MINUTE, jsonRows, posifloraCached, posifloraRange } from "@/lib/posiflora/cached";
import { isVtbSandbox } from "@/lib/payments/vtb";
import { dayStart, studioDate } from "@/lib/uchet/order-queries";
import { addDays, monthEnd, studioDay } from "@/lib/uchet/days";
import { realLocationIds, splitBySource, ttlFor } from "@/lib/uchet/summary";

// ================================================================
// «Деньги» за месяц: кассовые смены с расхождениями, поступления по
// способам оплаты, выдачи из кассы.
//
// Источник — по той же дате перехода, что «Сводка» и «Зарплата»: до неё
// Posiflora (смены и доли оплат — только чтение), после — Учёт. Выдачи из
// кассы Posiflora её API не отдаёт (причины видны, операций нет), поэтому
// до запуска раздел выдач честно пуст.
//
// Расхождения — главное, ради чего раздел: при открытии (в кассе не то,
// что оставили вчера) и при закрытии (насчитали не то, что должно быть).
// ================================================================

export type ShiftRow = {
  source: "posiflora" | "uchet";
  day: string;
  openedAt: string;
  closedAt: string | null;
  openedBy: string | null;
  closedBy: string | null;
  opening: number;
  /** Открыли не с тем, что оставили в прошлый раз: + больше, − меньше. */
  openingDiff: number | null;
  expected: number | null;
  counted: number | null;
  /** Насчитали при закрытии минус должно быть: + излишек, − недостача. */
  variance: number | null;
};

export type MethodTotal = { title: string; amount: number; note: string | null };
export type CashOut = { kind: string; title: string; amount: number; count: number };

export type Money = {
  month: string;
  from: string;
  to: string;
  isCurrent: boolean;
  shifts: ShiftRow[];
  methods: MethodTotal[];
  site: { count: number; amount: number; test: boolean };
  cashIn: CashOut[];
  cashOut: CashOut[];
  /** Месяц (или его часть) — до перехода на Учёт: выдачи из кассы не видны. */
  posifloraPart: { from: string; to: string } | null;
  errors: string[];
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------
// Posiflora
// ---------------------------------------------------------------

/** Экспорт — и для проверки вида на настоящих сменах без базы. */
export async function posifloraShifts(from: string, to: string): Promise<ShiftRow[]> {
  const ttl = to >= studioDate(0) ? 5 * MINUTE : 30 * MINUTE;
  const people = await posifloraCached("/workers?page[size]=100", 60 * MINUTE);
  const name = new Map(jsonRows(people).map((w) => [w.id, String(w.attributes?.firstName ?? "").trim() || null]));
  const out: ShiftRow[] = [];
  for (let page = 1; page <= 30; page++) {
    const list = jsonRows(await posifloraCached(`/shifts?page[size]=100&page[number]=${page}&sort=-openedAt`, ttl));
    for (const s of list) {
      const a = s.attributes ?? {};
      const day = String(a.date ?? "").slice(0, 10);
      if (day < from || day > to) continue;
      const closed = a.status === "closed";
      out.push({
        source: "posiflora",
        day,
        openedAt: String(a.openedAt ?? ""),
        closedAt: a.closedAt ? String(a.closedAt) : null,
        openedBy: name.get(s.relationships?.openedBy?.data?.id ?? "") ?? null,
        closedBy: name.get(s.relationships?.closedBy?.data?.id ?? "") ?? null,
        opening: num(a.openingAmount),
        openingDiff: num(a.openingAmountDiff) || null,
        expected: closed ? num(a.expected) : null,
        counted: closed ? num(a.actual) : null,
        variance: closed ? num(a.variance) || null : null,
      });
    }
    const oldest = String(list[list.length - 1]?.attributes?.date ?? "");
    if (list.length < 100 || (oldest && oldest < from)) break;
  }
  return out;
}

async function posifloraMethods(from: string, to: string): Promise<MethodTotal[]> {
  const [stats, settings] = await Promise.all([
    posifloraCached(`/stats/stores/payments?${posifloraRange(from, to)}`, ttlFor(to)),
    getSupabaseAdmin().from("pos_settings").select("posiflora_payment_names").eq("id", true).maybeSingle(),
  ]);
  const names = (settings.data?.posiflora_payment_names ?? {}) as Record<string, string>;
  return jsonRows(stats).map((p, i) => {
    const id = p.relationships?.paymentMethod?.data?.id ?? p.id;
    return { title: names[id] ?? `Способ ${i + 1} (Posiflora)`, amount: num(p.attributes?.amount), note: names[id] ? null : "подпишите в «Сводке»" };
  });
}

// ---------------------------------------------------------------
// Учёт
// ---------------------------------------------------------------

type ShiftDb = {
  opened_at: string;
  closed_at: string | null;
  status: string;
  opening_cash: number | string;
  previous_counted_cash: number | string | null;
  expected_cash: number | string | null;
  counted_cash: number | string | null;
  opener: { short_name: string } | { short_name: string }[] | null;
  closer: { short_name: string } | { short_name: string }[] | null;
};

async function uchetShifts(from: string, to: string, locations: string[]): Promise<ShiftRow[]> {
  if (!locations.length) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("pos_shifts")
    .select(
      "opened_at, closed_at, status, opening_cash, previous_counted_cash, expected_cash, counted_cash, opener:hr_employees!pos_shifts_opened_by_fkey(short_name), closer:hr_employees!pos_shifts_closed_by_fkey(short_name)"
    )
    .in("location_id", locations)
    .gte("opened_at", dayStart(from))
    .lt("opened_at", dayStart(addDays(to, 1)))
    .order("opened_at", { ascending: false });
  if (error) throw new Error(`Смены: ${error.message}`);
  return ((data ?? []) as unknown as ShiftDb[]).map((s) => {
    const closed = s.status === "closed";
    const prev = s.previous_counted_cash === null ? null : num(s.previous_counted_cash);
    const expected = closed && s.expected_cash !== null ? num(s.expected_cash) : null;
    const counted = closed && s.counted_cash !== null ? num(s.counted_cash) : null;
    return {
      source: "uchet",
      day: studioDay(s.opened_at),
      openedAt: s.opened_at,
      closedAt: s.closed_at,
      openedBy: one(s.opener)?.short_name ?? null,
      closedBy: one(s.closer)?.short_name ?? null,
      opening: num(s.opening_cash),
      openingDiff: prev === null ? null : num(s.opening_cash) - prev || null,
      expected,
      counted,
      variance: expected !== null && counted !== null ? counted - expected || null : null,
    };
  });
}

async function uchetMethods(from: string, to: string, locations: string[]): Promise<MethodTotal[]> {
  if (!locations.length) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("pos_payments")
    .select("amount, pos_payment_methods(title), pos_sales!inner(location_id, status, created_at)")
    .in("pos_sales.location_id", locations)
    .eq("pos_sales.status", "paid")
    .gte("pos_sales.created_at", dayStart(from))
    .lt("pos_sales.created_at", dayStart(addDays(to, 1)))
    .limit(20000);
  if (error) throw new Error(`Оплаты: ${error.message}`);
  const by = new Map<string, number>();
  for (const p of (data ?? []) as unknown as { amount: number | string; pos_payment_methods: { title: string } | { title: string }[] | null }[]) {
    const title = one(p.pos_payment_methods)?.title ?? "—";
    by.set(title, (by.get(title) ?? 0) + num(p.amount));
  }
  return [...by.entries()].map(([title, amount]) => ({ title, amount, note: null }));
}

async function uchetCash(from: string, to: string, locations: string[]): Promise<{ cashIn: CashOut[]; cashOut: CashOut[] }> {
  if (!locations.length) return { cashIn: [], cashOut: [] };
  const { data, error } = await getSupabaseAdmin()
    .from("pos_cash_movements")
    .select("direction, amount, pos_cash_reasons(title, kind), pos_shifts!inner(location_id)")
    .in("pos_shifts.location_id", locations)
    .gte("created_at", dayStart(from))
    .lt("created_at", dayStart(addDays(to, 1)))
    .limit(20000);
  if (error) throw new Error(`Движения наличных: ${error.message}`);
  const sum = (dir: "in" | "out") => {
    const by = new Map<string, CashOut>();
    for (const m of (data ?? []) as unknown as { direction: string; amount: number | string; pos_cash_reasons: { title: string; kind: string } | { title: string; kind: string }[] | null }[]) {
      if (m.direction !== dir) continue;
      const r = one(m.pos_cash_reasons);
      const key = r?.title ?? "—";
      const cur = by.get(key) ?? { kind: r?.kind ?? "other", title: key, amount: 0, count: 0 };
      by.set(key, { ...cur, amount: cur.amount + num(m.amount), count: cur.count + 1 });
    }
    return [...by.values()].sort((a, b) => b.amount - a.amount);
  };
  return { cashIn: sum("in"), cashOut: sum("out") };
}

async function siteOnline(from: string, to: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select("total_amount")
    .eq("payment_status", "paid")
    .gte("paid_at", dayStart(from))
    .lt("paid_at", dayStart(addDays(to, 1)))
    .limit(20000);
  if (error) throw new Error(`Оплаты сайта: ${error.message}`);
  return { count: (data ?? []).length, amount: (data ?? []).reduce((s, o) => s + num(o.total_amount), 0), test: isVtbSandbox() };
}

// ---------------------------------------------------------------

export async function loadMoney(month: string): Promise<Money> {
  const today = studioDate(0);
  const from = `${month}-01`;
  const to = month === today.slice(0, 7) ? today : monthEnd(month);
  const [{ data: settings }, locations] = await Promise.all([
    getSupabaseAdmin().from("pos_settings").select("summary_uchet_since").eq("id", true).maybeSingle(),
    realLocationIds(),
  ]);
  const since = (settings?.summary_uchet_since as string | null) ?? null;
  const parts = splitBySource(from, to, since);
  const posi = parts.find((p) => p.source === "posiflora") ?? null;
  const uchet = parts.find((p) => p.source === "uchet") ?? null;
  const errors: string[] = [];
  const safe = async <T,>(label: string, fn: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      console.error(`[dengi] ${label}:`, msg(e));
      errors.push(`${label}: ${msg(e).slice(0, 160)}`);
      return empty;
    }
  };

  const [pShifts, pMethods, uShifts, uMethods, cash, site] = await Promise.all([
    posi ? safe("смены Posiflora", () => posifloraShifts(posi.from, posi.to), []) : Promise.resolve([]),
    posi ? safe("оплаты Posiflora", () => posifloraMethods(posi.from, posi.to), []) : Promise.resolve([]),
    uchet ? safe("смены Учёта", () => uchetShifts(uchet.from, uchet.to, locations), []) : Promise.resolve([]),
    uchet ? safe("оплаты Учёта", () => uchetMethods(uchet.from, uchet.to, locations), []) : Promise.resolve([]),
    uchet ? safe("наличные Учёта", () => uchetCash(uchet.from, uchet.to, locations), { cashIn: [], cashOut: [] }) : Promise.resolve({ cashIn: [], cashOut: [] }),
    safe("оплаты сайта", () => siteOnline(from, to), { count: 0, amount: 0, test: false }),
  ]);

  // Способы с одинаковым названием (Posiflora до перехода и Учёт после) — одной строкой.
  const methods = new Map<string, MethodTotal>();
  for (const m of [...pMethods, ...uMethods]) {
    const cur = methods.get(m.title);
    methods.set(m.title, cur ? { ...cur, amount: cur.amount + m.amount } : m);
  }

  return {
    month,
    from,
    to,
    isCurrent: month === today.slice(0, 7),
    shifts: [...uShifts, ...pShifts].sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    methods: [...methods.values()].sort((a, b) => b.amount - a.amount),
    site,
    cashIn: cash.cashIn,
    cashOut: cash.cashOut,
    posifloraPart: posi ? { from: posi.from, to: posi.to } : null,
    errors,
  };
}
