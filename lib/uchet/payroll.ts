import { getSupabaseAdmin } from "@/lib/supabase";
import { MINUTE, jsonRows, posifloraCached, posifloraRange } from "@/lib/posiflora/cached";
import { dayStart, studioDate } from "@/lib/uchet/order-queries";
import { addDays, daysIn, eachDay, monthEnd, nextMonth, prevMonth, studioDay } from "@/lib/uchet/days";
import { allRows, realLocationIds, splitBySource, ttlFor } from "@/lib/uchet/summary";
import { describePart, type PayKind, type PayPart, type SalesBase } from "@/lib/uchet/pay-parts";
import type { Position } from "@/lib/uchet/positions";

// ================================================================
// Зарплата: начислено по схеме, премии и удержания, выдано, осталось.
//
// Откуда факты (как и в «Сводке» — по дате перехода summary_uchet_since):
//   * до перехода — Posiflora: личные продажи (stats/workers), продажи
//     точки по дням (stats/revenue), рабочие дни — по сменам, которые
//     человек открыл или закрыл;
//   * после — Учёт: чеки, вход по PIN, собранные букеты, доставки.
// Ручные отметки табеля перекрывают и то и другое.
//
// «Осталось выдать» — накопительно: долг с прошлых месяцев плюс месяц.
// Так выдача 5 ноября за октябрь не требует решать, «за какой она месяц».
//
// Если Posiflora не ответила, расчёт не притворяется: страница говорит,
// что части от продаж и смен не посчитаны, а не показывает их нулями.
// ================================================================

export type PayRule = PayPart & { id: string; validFrom: string; validTo: string | null };
export type DayMark = { day: string; auto: "posiflora" | "pin" | null; manual: boolean | null; worked: boolean };
export type PayLine = { kind: PayKind; label: string; detail: string; amount: number; note: string | null };
export type PayoutRow = { id: string | null; paidOn: string; amount: number; method: string; source: "manual" | "till"; comment: string | null };
export type AdjustmentRow = { id: string; amount: number; comment: string; createdAt: string };

export type EmployeePay = {
  id: string;
  fullName: string;
  shortName: string;
  position: Position;
  isActive: boolean;
  staffId: string | null;
  posifloraWorkerId: string | null;
  posifloraName: string | null;
  /** Части, действующие хоть день в этом месяце (все версии). */
  rules: PayRule[];
  /** Схема на последний день периода — её показывает и правит редактор. */
  current: PayPart[];
  currentFrom: string | null;
  days: DayMark[];
  workedDays: number;
  ownSales: number;
  lines: PayLine[];
  accrued: number;
  adjustments: AdjustmentRow[];
  adjustmentsTotal: number;
  payouts: PayoutRow[];
  paidTotal: number;
  carried: number;
  balance: number;
};

export type Payroll = {
  month: string;
  from: string;
  /** Последний учтённый день: для текущего месяца — сегодня. */
  to: string;
  isCurrent: boolean;
  today: string;
  employees: EmployeePay[];
  posifloraWorkers: { id: string; name: string }[];
  /** Сотрудники Posiflora, у которых нет пары в Учёте. */
  unlinked: { id: string; name: string }[];
  posifloraError: string | null;
  totals: { accrued: number; paid: number; balance: number };
};

const MAX_HISTORY_MONTHS = 12;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rub = (n: number) => Math.round(n);
const plural = (n: number, one: string, few: string, many: string) => {
  const l = n % 10;
  const t = n % 100;
  if (l === 1 && t !== 11) return one;
  if (l >= 2 && l <= 4 && (t < 12 || t > 14)) return few;
  return many;
};

// ---------------------------------------------------------------
// Posiflora: сотрудники, смены, продажи
// ---------------------------------------------------------------

export async function posifloraWorkers(): Promise<{ id: string; name: string }[]> {
  const res = await posifloraCached("/workers?page[size]=100", 60 * MINUTE);
  return jsonRows(res).map((w) => ({
    id: w.id,
    name: [w.attributes?.firstName, w.attributes?.lastName].filter(Boolean).join(" ").trim() || "Без имени",
  }));
}

/**
 * Рабочие дни по сменам Posiflora: кто открыл или закрыл смену в этот
 * день, тот работал. Второго флориста в загруженный день смена не знает —
 * его владелец отмечает в табеле.
 */
export async function posifloraShiftDays(from: string, to: string): Promise<Map<string, Set<string>>> {
  const byWorker = new Map<string, Set<string>>();
  const ttl = to >= studioDate(0) ? 5 * MINUTE : 30 * MINUTE;
  for (let page = 1; page <= 30; page++) {
    const res = await posifloraCached(`/shifts?page[size]=100&page[number]=${page}&sort=-openedAt`, ttl);
    const list = jsonRows(res);
    for (const s of list) {
      const day = String(s.attributes?.date ?? "").slice(0, 10);
      if (day < from || day > to) continue;
      for (const rel of ["openedBy", "closedBy"]) {
        const id = s.relationships?.[rel]?.data?.id;
        if (!id) continue;
        const set = byWorker.get(id) ?? new Set<string>();
        set.add(day);
        byWorker.set(id, set);
      }
    }
    const oldest = String(list[list.length - 1]?.attributes?.date ?? "");
    if (list.length < 100 || (oldest && oldest < from)) break;
  }
  return byWorker;
}

export async function posifloraOwnSales(from: string, to: string): Promise<Map<string, number>> {
  const res = await posifloraCached(`/stats/stores/workers?${posifloraRange(from, to)}`, ttlFor(to));
  return new Map(jsonRows(res).map((w) => [w.relationships?.worker?.data?.id ?? "", num(w.attributes?.salesAmount)]));
}

export async function posifloraStoreByDay(from: string, to: string): Promise<Map<string, number>> {
  const res = await posifloraCached(`/stats/stores/revenue?${posifloraRange(from, to)}`, ttlFor(to));
  return new Map(jsonRows(res).map((r) => [String(r.attributes?.date ?? ""), num(r.attributes?.amount)]));
}

// ---------------------------------------------------------------
// Факты месяца
// ---------------------------------------------------------------

/** Экспорт этого и computeEmployee — чтобы расчёт можно было проверить на примере без базы. */
export type Employee = {
  id: string;
  fullName: string;
  shortName: string;
  position: Position;
  isActive: boolean;
  staffId: string | null;
  posifloraWorkerId: string | null;
};

export type MonthFacts = {
  month: string;
  from: string;
  to: string;
  posiPart: { from: string; to: string } | null;
  storeByDay: Map<string, number>;
  uchetOwn: Map<string, Map<string, number>>;
  shiftDays: Map<string, Set<string>>;
  bouquets: Map<string, string[]>;
  deliveries: Map<string, string[]>;
  workRows: Map<string, Map<string, { worked: boolean; source: string }>>;
  adjustments: Map<string, AdjustmentRow[]>;
  payouts: Map<string, PayoutRow[]>;
  /** Личные продажи Posiflora по отрезкам «from|to» — только те, что понадобились. */
  posiOwnCache: Map<string, Promise<Map<string, number>>>;
  posifloraError: string | null;
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

async function loadMonthFacts(month: string, today: string, since: string | null, locations: string[], needsPosiflora: boolean): Promise<MonthFacts> {
  const from = `${month}-01`;
  const to = month === today.slice(0, 7) ? today : monthEnd(month);
  const parts = splitBySource(from, to, since);
  const posiPart = parts.find((p) => p.source === "posiflora") ?? null;
  const uchetPart = parts.find((p) => p.source === "uchet") ?? null;
  const admin = getSupabaseAdmin();

  const facts: MonthFacts = {
    month,
    from,
    to,
    posiPart: posiPart ? { from: posiPart.from, to: posiPart.to } : null,
    storeByDay: new Map(),
    uchetOwn: new Map(),
    shiftDays: new Map(),
    bouquets: new Map(),
    deliveries: new Map(),
    workRows: new Map(),
    adjustments: new Map(),
    payouts: new Map(),
    posiOwnCache: new Map(),
    posifloraError: null,
  };

  const inLocations = locations.length ? locations : ["00000000-0000-0000-0000-000000000000"];
  const next = dayStart(addDays(to, 1));

  const [sales, bouquets, siteDeliveries, shopDeliveries, work, adjustments, payouts, till] = await Promise.all([
    uchetPart
      ? allRows<{ total: number | string; created_at: string; employee_id: string | null }>((a, b) =>
          admin
            .from("pos_sales")
            .select("total, created_at, employee_id")
            .in("location_id", inLocations)
            .eq("status", "paid")
            .eq("carried_over", false)
            .gte("created_at", dayStart(uchetPart.from))
            .lt("created_at", next)
            .range(a, b)
        )
      : Promise.resolve([]),
    allRows<{ assembled_by: string | null; assembled_at: string }>((a, b) =>
      admin
        .from("pos_bouquets")
        .select("assembled_by, assembled_at")
        .in("location_id", inLocations)
        .neq("status", "disassembled")
        .not("assembled_by", "is", null)
        .gte("assembled_at", dayStart(from))
        .lt("assembled_at", next)
        .range(a, b)
    ),
    allRows<{ courier_staff_id: string; delivery_date: string }>((a, b) =>
      admin
        .from("orders")
        .select("courier_staff_id, delivery_date")
        .eq("status", "completed")
        .eq("is_pickup", false)
        .not("courier_staff_id", "is", null)
        .gte("delivery_date", from)
        .lte("delivery_date", to)
        .range(a, b)
    ),
    allRows<{ courier_staff_id: string; delivery_date: string }>((a, b) =>
      admin
        .from("pos_orders")
        .select("courier_staff_id, delivery_date")
        .in("location_id", inLocations)
        .eq("status", "completed")
        .eq("is_pickup", false)
        .not("courier_staff_id", "is", null)
        .gte("delivery_date", from)
        .lte("delivery_date", to)
        .range(a, b)
    ),
    admin.from("hr_work_days").select("employee_id, day, worked, source").gte("day", from).lte("day", monthEnd(month)),
    admin.from("hr_pay_adjustments").select("id, employee_id, amount, comment, created_at").eq("month", from).order("created_at"),
    admin.from("hr_payouts").select("id, employee_id, paid_on, amount, method, comment").gte("paid_on", from).lte("paid_on", monthEnd(month)).order("paid_on"),
    // Выдачи из кассы Учёта: изъятие с причиной «Зарплата» и тем, кому выдано.
    admin
      .from("pos_cash_movements")
      .select("amount, created_at, paid_employee_id, comment, pos_shifts!inner(location_id)")
      .not("paid_employee_id", "is", null)
      .in("pos_shifts.location_id", inLocations)
      .gte("created_at", dayStart(from))
      .lt("created_at", dayStart(addDays(monthEnd(month), 1))),
  ]);
  for (const r of [work, adjustments, payouts, till]) if (r.error) throw new Error(`Зарплата: ${r.error.message}`);

  for (const s of sales) {
    const day = studioDay(s.created_at);
    const total = num(s.total);
    facts.storeByDay.set(day, (facts.storeByDay.get(day) ?? 0) + total);
    if (s.employee_id) {
      const own = facts.uchetOwn.get(s.employee_id) ?? new Map<string, number>();
      own.set(day, (own.get(day) ?? 0) + total);
      facts.uchetOwn.set(s.employee_id, own);
    }
  }
  for (const b of bouquets) if (b.assembled_by) push(facts.bouquets, b.assembled_by, studioDay(b.assembled_at));
  for (const d of [...siteDeliveries, ...shopDeliveries]) push(facts.deliveries, d.courier_staff_id, d.delivery_date);
  for (const w of work.data ?? []) {
    const m = facts.workRows.get(w.employee_id) ?? new Map();
    m.set(w.day, { worked: w.worked, source: w.source });
    facts.workRows.set(w.employee_id, m);
  }
  for (const a of adjustments.data ?? []) push(facts.adjustments, a.employee_id, { id: a.id, amount: num(a.amount), comment: a.comment, createdAt: a.created_at });
  for (const p of payouts.data ?? []) push(facts.payouts, p.employee_id, { id: p.id, paidOn: p.paid_on, amount: num(p.amount), method: p.method, source: "manual", comment: p.comment });
  for (const t of (till.data ?? []) as unknown as { amount: number | string; created_at: string; paid_employee_id: string; comment: string | null }[]) {
    push(facts.payouts, t.paid_employee_id, { id: null, paidOn: studioDay(t.created_at), amount: num(t.amount), method: "cash", source: "till", comment: t.comment });
  }

  if (posiPart && needsPosiflora) {
    try {
      const [store, shifts] = await Promise.all([posifloraStoreByDay(posiPart.from, posiPart.to), posifloraShiftDays(posiPart.from, posiPart.to)]);
      for (const [day, amount] of store) facts.storeByDay.set(day, (facts.storeByDay.get(day) ?? 0) + amount);
      facts.shiftDays = shifts;
    } catch (e) {
      facts.posifloraError = e instanceof Error ? e.message : String(e);
      console.error("[zarplata] Posiflora:", facts.posifloraError);
    }
  }
  return facts;
}

// ---------------------------------------------------------------
// Расчёт одного человека за месяц
// ---------------------------------------------------------------

function dayMarks(e: Employee, f: MonthFacts): DayMark[] {
  const rows = f.workRows.get(e.id);
  const shift = e.posifloraWorkerId ? f.shiftDays.get(e.posifloraWorkerId) : undefined;
  return eachDay(f.from, monthEnd(f.month)).map((day) => {
    const row = rows?.get(day);
    const fromPosiflora = !!shift?.has(day) && !!f.posiPart && day >= f.posiPart.from && day <= f.posiPart.to;
    const auto = fromPosiflora ? "posiflora" : row?.source === "pin" && row.worked ? "pin" : null;
    const manual = row?.source === "manual" ? row.worked : null;
    return { day, auto, manual, worked: manual ?? auto !== null };
  });
}

async function ownSalesBetween(e: Employee, f: MonthFacts, from: string, to: string): Promise<{ amount: number; missing: boolean }> {
  let amount = 0;
  let missing = false;
  const own = f.uchetOwn.get(e.id);
  if (own) for (const [day, v] of own) if (day >= from && day <= to) amount += v;
  if (f.posiPart && e.posifloraWorkerId) {
    const a = from > f.posiPart.from ? from : f.posiPart.from;
    const b = to < f.posiPart.to ? to : f.posiPart.to;
    if (a <= b) {
      if (f.posifloraError) missing = true;
      else {
        const key = `${a}|${b}`;
        if (!f.posiOwnCache.has(key)) f.posiOwnCache.set(key, posifloraOwnSales(a, b));
        try {
          amount += (await f.posiOwnCache.get(key)!).get(e.posifloraWorkerId) ?? 0;
        } catch (err) {
          f.posifloraError = err instanceof Error ? err.message : String(err);
          missing = true;
        }
      }
    }
  } else if (f.posiPart && !e.posifloraWorkerId) {
    // До запуска свои продажи есть только в Posiflora — без связи их не найти.
    const a = from > f.posiPart.from ? from : f.posiPart.from;
    const b = to < f.posiPart.to ? to : f.posiPart.to;
    if (a <= b) missing = true;
  }
  return { amount, missing };
}

const sumDays = (map: Map<string, number>, days: string[]) => days.reduce((s, d) => s + (map.get(d) ?? 0), 0);

export async function computeEmployee(e: Employee, rules: PayRule[], f: MonthFacts) {
  const days = dayMarks(e, f);
  const worked = new Set(days.filter((d) => d.worked && d.day <= f.to).map((d) => d.day));
  const monthDays = daysIn(f.from, monthEnd(f.month));
  const lines: PayLine[] = [];
  const posiDown = !!f.posifloraError;
  const beforeLaunch = (a: string, b: string) => !!f.posiPart && a <= f.posiPart.to && b >= f.posiPart.from;

  for (const r of rules) {
    const a = r.validFrom > f.from ? r.validFrom : f.from;
    const b = r.validTo && r.validTo < f.to ? r.validTo : f.to;
    if (a > b) continue;
    const segDays = eachDay(a, b);
    const segWorked = segDays.filter((d) => worked.has(d));
    // Отрезок дней — только если схема сменилась внутри месяца; «месяц ещё идёт» видно и так.
    const whole = r.validFrom <= f.from && (!r.validTo || r.validTo >= monthEnd(f.month));
    const span = whole ? "" : ` (${Number(a.slice(8, 10))}–${Number(b.slice(8, 10))})`;
    const label = describePart(r) + span;

    switch (r.kind) {
      case "monthly": {
        const amount = (r.amount ?? 0) * (segDays.length / monthDays);
        lines.push({ kind: r.kind, label, detail: segDays.length === monthDays ? "за месяц" : `за ${segDays.length} из ${monthDays} дн.`, amount: rub(amount), note: null });
        break;
      }
      case "per_shift": {
        const note = posiDown && beforeLaunch(a, b) && e.posifloraWorkerId ? "смены из Posiflora не загрузились" : null;
        lines.push({ kind: r.kind, label, detail: `× ${segWorked.length} ${plural(segWorked.length, "день", "дня", "дней")}`, amount: rub((r.amount ?? 0) * segWorked.length), note });
        break;
      }
      case "sales_percent": {
        const share = (r.percent ?? 0) / 100;
        if (r.base === "own") {
          const own = await ownSalesBetween(e, f, a, b);
          const note = own.missing ? (e.posifloraWorkerId ? "продажи из Posiflora не загрузились" : "свяжите с сотрудником Posiflora — до запуска продажи там") : null;
          lines.push({ kind: r.kind, label, detail: `от ${rub(own.amount).toLocaleString("ru-RU")} ₽`, amount: rub(own.amount * share), note });
        } else {
          const base = r.base === "store" ? sumDays(f.storeByDay, segDays) : sumDays(f.storeByDay, segWorked);
          const note = posiDown && beforeLaunch(a, b) ? "продажи из Posiflora не загрузились" : null;
          const detail = r.base === "store" ? `от ${rub(base).toLocaleString("ru-RU")} ₽` : `от ${rub(base).toLocaleString("ru-RU")} ₽ за ${segWorked.length} ${plural(segWorked.length, "день", "дня", "дней")}`;
          lines.push({ kind: r.kind, label, detail, amount: rub(base * share), note });
        }
        break;
      }
      case "per_bouquet": {
        const n = (f.bouquets.get(e.id) ?? []).filter((d) => d >= a && d <= b).length;
        const note = beforeLaunch(a, b) ? "букеты считает Учёт — до запуска их тут нет" : null;
        lines.push({ kind: r.kind, label, detail: `× ${n}`, amount: rub((r.amount ?? 0) * n), note });
        break;
      }
      case "per_delivery": {
        const n = e.staffId ? (f.deliveries.get(e.staffId) ?? []).filter((d) => d >= a && d <= b).length : 0;
        const note = !e.staffId ? "у человека нет своего входа курьера — доставки не к кому привязать" : beforeLaunch(a, b) ? "доставки до запуска — в Posiflora, тут их нет" : null;
        lines.push({ kind: r.kind, label, detail: `× ${n}`, amount: rub((r.amount ?? 0) * n), note });
        break;
      }
    }
  }

  const own = await ownSalesBetween(e, f, f.from, f.to);
  const adjustments = f.adjustments.get(e.id) ?? [];
  const payouts = (f.payouts.get(e.id) ?? []).sort((x, y) => x.paidOn.localeCompare(y.paidOn));
  return {
    days,
    workedDays: worked.size,
    ownSales: own.amount,
    lines,
    accrued: lines.reduce((s, l) => s + l.amount, 0),
    adjustments,
    adjustmentsTotal: adjustments.reduce((s, x) => s + x.amount, 0),
    payouts,
    paidTotal: payouts.reduce((s, x) => s + x.amount, 0),
  };
}

// ---------------------------------------------------------------
// Всё вместе
// ---------------------------------------------------------------

const rulesFor = (all: PayRule[], from: string, to: string) => all.filter((r) => r.validFrom <= to && (!r.validTo || r.validTo >= from));
const needsPosifloraFor = (rules: PayRule[]) => rules.some((r) => r.kind === "per_shift" || r.kind === "sales_percent");

export async function loadPayroll(month: string): Promise<Payroll> {
  const today = studioDate(0);
  const admin = getSupabaseAdmin();

  const [{ data: emps, error: empError }, { data: ruleRows, error: ruleError }, { data: settings, error: setError }, locations, firstPay, firstAdj] = await Promise.all([
    admin.from("hr_employees").select("id, full_name, short_name, position, is_active, staff_id, posiflora_worker_id, sort").order("is_active", { ascending: false }).order("sort").order("short_name"),
    admin.from("hr_pay_rules").select("id, employee_id, kind, amount, percent, base, valid_from, valid_to").order("valid_from"),
    admin.from("pos_settings").select("summary_uchet_since").eq("id", true).maybeSingle(),
    // Только настоящие места: чеки и выдачи «Тренировки» в зарплату не идут.
    realLocationIds(),
    admin.from("hr_payouts").select("paid_on").order("paid_on").limit(1),
    admin.from("hr_pay_adjustments").select("month").order("month").limit(1),
  ]);
  if (empError) throw new Error(`Сотрудники: ${empError.message}`);
  if (ruleError) throw new Error(`Схемы оплаты: ${ruleError.message}`);
  if (setError) throw new Error(`Настройки: ${setError.message}`);
  const since = (settings?.summary_uchet_since as string | null) ?? null;

  const employees: Employee[] = (emps ?? []).map((e) => ({
    id: e.id,
    fullName: e.full_name,
    shortName: e.short_name,
    position: e.position as Position,
    isActive: e.is_active,
    staffId: e.staff_id,
    posifloraWorkerId: e.posiflora_worker_id,
  }));
  const rulesByEmp = new Map<string, PayRule[]>();
  for (const r of ruleRows ?? []) {
    push(rulesByEmp, r.employee_id, {
      id: r.id,
      kind: r.kind as PayKind,
      amount: r.amount === null ? null : num(r.amount),
      percent: r.percent === null ? null : num(r.percent),
      base: (r.base as SalesBase | null) ?? null,
      validFrom: r.valid_from,
      validTo: r.valid_to,
    });
  }

  let workers: { id: string; name: string }[] = [];
  let posifloraError: string | null = null;
  try {
    workers = await posifloraWorkers();
  } catch (e) {
    posifloraError = e instanceof Error ? e.message : String(e);
  }
  const workerName = new Map(workers.map((w) => [w.id, w.name]));

  // С какого месяца копится «осталось выдать»: первая схема, выдача или премия.
  const starts = [(ruleRows ?? [])[0]?.valid_from, firstPay.data?.[0]?.paid_on, firstAdj.data?.[0]?.month].filter(Boolean).map((d) => String(d).slice(0, 7));
  let start = starts.length ? starts.sort()[0] : month;
  let earliest = month;
  for (let i = 0; i < MAX_HISTORY_MONTHS; i++) earliest = prevMonth(earliest);
  if (start < earliest) start = earliest;

  const allRules = [...rulesByEmp.values()].flat();
  const carried = new Map<string, number>();
  for (let m = start; m < month; m = nextMonth(m)) {
    const from = `${m}-01`;
    const facts = await loadMonthFacts(m, today, since, locations, needsPosifloraFor(rulesFor(allRules, from, monthEnd(m))));
    if (facts.posifloraError) posifloraError ??= facts.posifloraError;
    for (const e of employees) {
      const r = await computeEmployee(e, rulesFor(rulesByEmp.get(e.id) ?? [], from, facts.to), facts);
      carried.set(e.id, (carried.get(e.id) ?? 0) + r.accrued + r.adjustmentsTotal - r.paidTotal);
    }
  }

  const facts = await loadMonthFacts(month, today, since, locations, needsPosifloraFor(rulesFor(allRules, `${month}-01`, monthEnd(month))));
  if (facts.posifloraError) posifloraError ??= facts.posifloraError;

  const result: EmployeePay[] = [];
  for (const e of employees) {
    const rules = rulesFor(rulesByEmp.get(e.id) ?? [], facts.from, facts.to);
    const r = await computeEmployee(e, rules, facts);
    // Схема «на сейчас»: что действует в последний учтённый день месяца.
    const current = (rulesByEmp.get(e.id) ?? []).filter((x) => x.validFrom <= facts.to && (!x.validTo || x.validTo >= facts.to));
    const before = carried.get(e.id) ?? 0;
    result.push({
      ...e,
      posifloraName: e.posifloraWorkerId ? workerName.get(e.posifloraWorkerId) ?? null : null,
      rules,
      current: current.map(({ kind, amount, percent, base }) => ({ kind, amount, percent, base })),
      currentFrom: current[0]?.validFrom ?? null,
      ...r,
      carried: rub(before),
      balance: rub(before + r.accrued + r.adjustmentsTotal - r.paidTotal),
    });
  }
  if (facts.posifloraError) posifloraError ??= facts.posifloraError;

  const linked = new Set(employees.map((e) => e.posifloraWorkerId).filter(Boolean));
  return {
    month,
    from: facts.from,
    to: facts.to,
    isCurrent: month === today.slice(0, 7),
    today,
    employees: result,
    posifloraWorkers: workers,
    unlinked: workers.filter((w) => !linked.has(w.id)),
    posifloraError,
    totals: {
      accrued: result.reduce((s, e) => s + e.accrued + e.adjustmentsTotal, 0),
      paid: result.reduce((s, e) => s + e.paidTotal, 0),
      balance: result.reduce((s, e) => s + e.balance, 0),
    },
  };
}

/** ?m=2026-10 → месяц; будущее и мусор → текущий. */
export function resolvePayMonth(m: string | undefined): string {
  const current = studioDate(0).slice(0, 7);
  return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m <= current ? m : current;
}
