import { getSupabaseAdmin } from "@/lib/supabase";
import { posifloraFetch } from "@/lib/posiflora/http";
import { dayStart, studioDate } from "@/lib/uchet/order-queries";
import { getDefaultLocation } from "@/lib/uchet/queries";

// ================================================================
// «Сводка» для владельцев: деньги за период и порог дохода за год.
//
// Откуда цифры:
//   * Posiflora — пока продажи бьются там. Её статистику (выручка,
//     прибыль, оплаты, сотрудники, списания) читаем готовой, только GET.
//   * Учёт — с даты pos_settings.summary_uchet_since. До неё наши чеки —
//     параллельная работа: показываем их рядом для сверки, но не
//     складываем с Posiflora, иначе одна продажа посчиталась бы дважды.
//   * Сайт — заказы, оплаченные онлайн. В Posiflora у них сумма 0 (см.
//     lib/posiflora/orders.ts), так что дублей с ней нет.
//
// Если Posiflora не ответила, блок честно говорит «не загрузилось», а не
// показывает нули: ноль в сводке владелец прочтёт как «ничего не продали».
// ================================================================

const MIN = 60_000;
const DAY = 86_400_000;

/**
 * Порог дохода за год, после которого на УСН появляется НДС (с 1-го числа
 * следующего месяца), а патент теряется. На 2026 — 20 млн ₽ (закон
 * 04.07.2026 № 228-ФЗ оставил его до 2029 года). Новый год сюда — только
 * после сверки с бухгалтером: для неизвестного года сводка берёт последний
 * известный порог и прямо пишет, что его надо уточнить.
 */
const INCOME_LIMIT_BY_YEAR: Record<number, number> = { 2026: 20_000_000 };

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

// ---------------------------------------------------------------
// Даты — строками «2026-10-21» по Симферополю
// ---------------------------------------------------------------

const toMs = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => fromMs(toMs(day) + n * DAY);
const daysIn = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY) + 1;
const monthEnd = (month: string) => addDays(`${nextMonth(month)}-01`, -1);
function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function prevMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
export const monthTitle = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;

const studioDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" });
const studioDay = (iso: string) => studioDayFmt.format(new Date(iso));

// ---------------------------------------------------------------
// Период
// ---------------------------------------------------------------

export type PeriodKey = "today" | "week" | "month" | "prev" | "year" | "m";
export type Period = { key: PeriodKey; from: string; to: string; title: string; month: string | null };

/** ?p=today|week|month|prev|year или ?m=2026-05 (месяц целиком). */
export function resolvePeriod(params: { p?: string; m?: string }): Period {
  const today = studioDate(0);
  const thisMonth = today.slice(0, 7);

  if (params.m && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.m) && params.m <= thisMonth) {
    const to = params.m === thisMonth ? today : monthEnd(params.m);
    return { key: "m", from: `${params.m}-01`, to, title: `${monthTitle(params.m)} ${params.m.slice(0, 4)}`, month: params.m };
  }
  switch (params.p) {
    case "today":
      return { key: "today", from: today, to: today, title: "Сегодня", month: null };
    case "week":
      return { key: "week", from: addDays(today, -6), to: today, title: "7 дней", month: null };
    case "prev": {
      const m = prevMonth(thisMonth);
      return { key: "prev", from: `${m}-01`, to: monthEnd(m), title: monthTitle(m), month: m };
    }
    case "year":
      return { key: "year", from: `${today.slice(0, 4)}-01-01`, to: today, title: "С начала года", month: null };
    default:
      return { key: "month", from: `${thisMonth}-01`, to: today, title: monthTitle(thisMonth), month: thisMonth };
  }
}

// ---------------------------------------------------------------
// Что получает страница
// ---------------------------------------------------------------

export type SeriesPoint = { date: string; revenue: number; profit: number | null };

export type SourceBlock = {
  source: "posiflora" | "uchet";
  from: string;
  to: string;
  revenue: number;
  /** Сколько денег поступило — по этой цифре считается порог (доход на УСН — по оплатам). */
  received: number;
  checks: number;
  avgCheck: number;
  profit: number | null;
  marginPct: number | null;
  discount: number | null;
  returns: { qty: number; amount: number } | null;
  /** Изменение к прошлому периоду той же длины, в процентах. null — не с чем сравнить. */
  change: { revenue: number | null; checks: number | null; avgCheck: number | null; profit: number | null } | null;
  series: { step: "day" | "month"; points: SeriesPoint[] };
  payments: { id: string; title: string | null; amount: number; share: number }[];
  workers: { name: string; amount: number; avgCheck: number | null; share: number }[];
  writeoffs: { reason: string; amount: number; shareOfSales: number | null }[];
};

export type FailedBlock = { source: "posiflora" | "uchet"; from: string; to: string; error: string };

export type Threshold = {
  year: number;
  limit: number;
  /** false — порог на этот год в коде не записан, взят прошлогодний. */
  limitKnown: boolean;
  income: number;
  parts: { label: string; amount: number }[];
  extra: { amount: number; note: string | null };
  /** С какого месяца у Posiflora есть данные за год; раньше — пусто. */
  historyFrom: string | null;
  /** История начинается не с января, а доход «до неё» не вписан. */
  needsExtra: boolean;
  pacePerDay: number;
  paceDays: number;
  forecast: number;
  /** Порог уже пройден: в каком месяце (по помесячной выручке). */
  crossedMonth: string | null;
  /** Ещё не пройден: в какой день его пройдём по нынешнему темпу (в этом году). */
  crossDate: string | null;
  /** С какого числа НДС: 1-е число месяца после превышения — факт или прогноз. */
  vatFrom: string | null;
};

export type Summary = {
  period: Period;
  today: string;
  blocks: (SourceBlock | FailedBlock)[];
  site: { count: number; amount: number };
  /** Наши чеки за период, когда главный источник — Posiflora: для сверки. */
  reconcile: { revenue: number; checks: number } | null;
  threshold: Threshold | { error: string };
  uchetSince: string | null;
  /** Учёт запущен (есть настоящее место, не «Тренировка») — можно переключить сводку на него. */
  canSwitch: boolean;
};

export const isFailed = (b: SourceBlock | FailedBlock): b is FailedBlock => "error" in b;

// ---------------------------------------------------------------
// Posiflora — с кэшем в памяти процесса
// ---------------------------------------------------------------

type JsonApi = {
  data?: { id: string; type: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id: string } | null }> }[] | { attributes?: Record<string, unknown> };
  meta?: Record<string, unknown>;
  included?: { id: string; type: string; attributes?: Record<string, unknown> }[];
};

const cache = new Map<string, { at: number; ttl: number; value: JsonApi }>();

/**
 * Один и тот же отчёт за прошлый месяц не меняется — нет смысла спрашивать
 * его на каждое открытие. Период с сегодняшним днём живёт 3 минуты,
 * прошлое — 30. Ошибки не кэшируются: следующее открытие спросит снова.
 */
async function posi(path: string, ttl: number): Promise<JsonApi> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const value = (await posifloraFetch(path, { headers: { Accept: "application/vnd.api+json" } })) as JsonApi;
  if (cache.size > 300) cache.clear();
  cache.set(path, { at: Date.now(), ttl, value });
  return value;
}

const range = (from: string, to: string) => `filter[range]=custom&filter[rangeFrom]=${from}&filter[rangeTo]=${to}`;
const ttlFor = (to: string) => (to >= studioDate(0) ? 3 * MIN : 30 * MIN);

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Posiflora отдаёт 0, и когда сравнивать не с чем, — такой ноль не показываем. */
const pct = (value: unknown) => {
  const n = num(value);
  return n === 0 ? null : n;
};

function rows(res: JsonApi) {
  return Array.isArray(res.data) ? res.data : [];
}

function attrs(res: JsonApi): Record<string, unknown> {
  return Array.isArray(res.data) ? res.data[0]?.attributes ?? {} : res.data?.attributes ?? {};
}

async function posifloraGeneral(from: string, to: string) {
  return attrs(await posi(`/stats/stores/general?${range(from, to)}`, ttlFor(to)));
}

async function posifloraMonthly(from: string, to: string): Promise<SeriesPoint[]> {
  const res = await posi(`/stats/stores/revenue?${range(from, to)}`, ttlFor(to));
  return toMonths(rows(res).map((r) => ({ date: String(r.attributes?.date ?? ""), revenue: num(r.attributes?.amount), profit: null })));
}

async function loadPosifloraBlock(from: string, to: string, names: Record<string, string>): Promise<SourceBlock> {
  const R = range(from, to);
  const ttl = ttlFor(to);
  const [general, revenue, profit, payments, workers, writeoffs, people] = await Promise.all([
    posi(`/stats/stores/general?${R}`, ttl),
    posi(`/stats/stores/revenue?${R}`, ttl),
    posi(`/stats/stores/profit?${R}`, ttl),
    posi(`/stats/stores/payments?${R}`, ttl),
    posi(`/stats/stores/workers?${R}`, ttl),
    posi(`/stats/stores/write-off-stats?${R}&include=reason`, ttl),
    posi(`/workers?page[size]=100`, 60 * MIN),
  ]);

  const g = attrs(general);
  const profitByDate = new Map(rows(profit).map((r) => [String(r.attributes?.date ?? ""), num(r.attributes?.amount)]));
  const step = (revenue.meta?.step === "month" ? "month" : "day") as "day" | "month";

  const workerName = new Map(
    rows(people).map((w) => [w.id, [w.attributes?.firstName, w.attributes?.lastName].filter(Boolean).join(" ").trim() || "Без имени"])
  );
  const reasonTitle = new Map((writeoffs.included ?? []).map((r) => [r.id, String(r.attributes?.title ?? "Без причины")]));

  return {
    source: "posiflora",
    from,
    to,
    revenue: num(g.revenue),
    received: num(g.paymentsRevenue),
    checks: num(g.ordersQty),
    avgCheck: num(g.avgOrderSum),
    profit: num(g.profit),
    marginPct: num(g.marginality),
    discount: num(g.discountAmount),
    returns: { qty: num(g.ordersReturnedQty), amount: num(g.ordersReturnedAmount) },
    change: { revenue: pct(g.revenuePrev), checks: pct(g.ordersQtyPrev), avgCheck: pct(g.avgOrderSumPrev), profit: pct(g.profitPrev) },
    series: {
      step,
      points: rows(revenue).map((r) => {
        const date = String(r.attributes?.date ?? "");
        return { date, revenue: num(r.attributes?.amount), profit: profitByDate.get(date) ?? null };
      }),
    },
    payments: rows(payments)
      .map((p) => {
        const id = p.relationships?.paymentMethod?.data?.id ?? p.relationships?.method?.data?.id ?? p.id;
        return { id, title: names[id] ?? null, amount: num(p.attributes?.amount), share: num(p.attributes?.share) };
      })
      .sort((a, b) => b.amount - a.amount),
    workers: rows(workers)
      .map((w) => ({
        name: workerName.get(w.relationships?.worker?.data?.id ?? "") ?? "Без имени",
        amount: num(w.attributes?.salesAmount),
        avgCheck: num(w.attributes?.avgOrderAmount) || null,
        share: num(w.attributes?.share),
      }))
      .sort((a, b) => b.amount - a.amount),
    writeoffs: rows(writeoffs)
      .map((w) => ({
        reason: reasonTitle.get(w.relationships?.reason?.data?.id ?? "") ?? "Без причины",
        amount: num(w.attributes?.amount),
        shareOfSales: num(w.attributes?.shareSale) || null,
      }))
      .sort((a, b) => b.amount - a.amount),
  };
}

// ---------------------------------------------------------------
// Учёт
// ---------------------------------------------------------------

async function realLocationIds(): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin().from("inv_locations").select("id").eq("is_training", false).eq("is_active", true);
  if (error) throw new Error(`Места: ${error.message}`);
  return (data ?? []).map((l) => l.id);
}

/** PostgREST отдаёт не больше 1000 строк за раз — дочитываем страницами. */
async function allRows<T>(query: (fromRow: number, toRow: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await query(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

type SaleRow = {
  total: number | string;
  created_at: string;
  hr_employees: { short_name: string } | { short_name: string }[] | null;
  pos_payments: { method: string; amount: number | string; pos_payment_methods: { title: string } | { title: string }[] | null }[];
};

const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

async function loadUchetBlock(from: string, to: string, locations: string[]): Promise<SourceBlock> {
  const sales = locations.length
    ? await allRows<SaleRow>((a, b) =>
        getSupabaseAdmin()
          .from("pos_sales")
          .select("total, created_at, hr_employees!pos_sales_employee_id_fkey(short_name), pos_payments(method, amount, pos_payment_methods(title))")
          .in("location_id", locations)
          .eq("status", "paid")
          .gte("created_at", dayStart(from))
          .lt("created_at", dayStart(addDays(to, 1)))
          .order("created_at")
          .range(a, b)
      )
    : [];

  const byDay = new Map<string, number>();
  const byMethod = new Map<string, { title: string; amount: number }>();
  const byWorker = new Map<string, { amount: number; checks: number }>();
  let revenue = 0;
  for (const s of sales) {
    const total = num(s.total);
    revenue += total;
    const day = studioDay(s.created_at);
    byDay.set(day, (byDay.get(day) ?? 0) + total);
    const who = first(s.hr_employees)?.short_name ?? "Без отметки";
    const w = byWorker.get(who) ?? { amount: 0, checks: 0 };
    byWorker.set(who, { amount: w.amount + total, checks: w.checks + 1 });
    for (const p of s.pos_payments) {
      const m = byMethod.get(p.method) ?? { title: first(p.pos_payment_methods)?.title ?? p.method, amount: 0 };
      byMethod.set(p.method, { ...m, amount: m.amount + num(p.amount) });
    }
  }

  const days: SeriesPoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push({ date: d, revenue: byDay.get(d) ?? 0, profit: null });
  const step = daysIn(from, to) > 62 ? "month" : "day";
  const share = (amount: number) => (revenue > 0 ? Math.round((amount / revenue) * 10_000) / 100 : 0);
  const paid = [...byMethod.values()].reduce((sum, m) => sum + m.amount, 0);

  return {
    source: "uchet",
    from,
    to,
    revenue,
    received: revenue,
    checks: sales.length,
    avgCheck: sales.length ? revenue / sales.length : 0,
    // Прибыль и списания по Учёту появятся, когда закупка пойдёт приходом
    // на склад: до этого себестоимость продаж у нас — по снимку Posiflora.
    profit: null,
    marginPct: null,
    discount: null,
    returns: null,
    change: null,
    series: { step, points: step === "month" ? toMonths(days) : days },
    payments: [...byMethod.entries()]
      .map(([id, m]) => ({ id, title: m.title, amount: m.amount, share: paid > 0 ? Math.round((m.amount / paid) * 10_000) / 100 : 0 }))
      .sort((a, b) => b.amount - a.amount),
    workers: [...byWorker.entries()]
      .map(([name, w]) => ({ name, amount: w.amount, avgCheck: w.checks ? w.amount / w.checks : null, share: share(w.amount) }))
      .sort((a, b) => b.amount - a.amount),
    writeoffs: [],
  };
}

function toMonths(points: SeriesPoint[]): SeriesPoint[] {
  const out = new Map<string, SeriesPoint>();
  for (const p of points) {
    const key = `${p.date.slice(0, 7)}-01`;
    const cur = out.get(key) ?? { date: key, revenue: 0, profit: p.profit === null ? null : 0 };
    out.set(key, { date: key, revenue: cur.revenue + p.revenue, profit: cur.profit === null || p.profit === null ? null : cur.profit + p.profit });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------
// Сайт
// ---------------------------------------------------------------

async function sitePaid(from: string, to: string): Promise<{ count: number; amount: number; byMonth: Map<string, number> }> {
  const list = await allRows<{ total_amount: number | string; paid_at: string }>((a, b) =>
    getSupabaseAdmin()
      .from("orders")
      .select("total_amount, paid_at")
      .eq("payment_status", "paid")
      .gte("paid_at", dayStart(from))
      .lt("paid_at", dayStart(addDays(to, 1)))
      .range(a, b)
  );
  const byMonth = new Map<string, number>();
  let amount = 0;
  for (const o of list) {
    const v = num(o.total_amount);
    amount += v;
    const m = studioDay(o.paid_at).slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + v);
  }
  return { count: list.length, amount, byMonth };
}

// ---------------------------------------------------------------
// Порог дохода за год
// ---------------------------------------------------------------

/** Части диапазона по источникам: до даты перехода — Posiflora, с неё — Учёт. */
function splitBySource(from: string, to: string, since: string | null): { source: "posiflora" | "uchet"; from: string; to: string }[] {
  if (!since || to < since) return [{ source: "posiflora", from, to }];
  if (from >= since) return [{ source: "uchet", from, to }];
  return [
    { source: "posiflora", from, to: addDays(since, -1) },
    { source: "uchet", from: since, to },
  ];
}

/** Поступления за диапазон — Posiflora/Учёт по дате перехода плюс оплаты сайта. */
async function receivedBetween(from: string, to: string, since: string | null, locations: string[]) {
  const parts = splitBySource(from, to, since);
  const sums = await Promise.all(
    parts.map(async (p) => (p.source === "posiflora" ? num((await posifloraGeneral(p.from, p.to)).paymentsRevenue) : (await loadUchetBlock(p.from, p.to, locations)).received))
  );
  return { posiflora: parts.reduce((s, p, i) => s + (p.source === "posiflora" ? sums[i] : 0), 0), uchet: parts.reduce((s, p, i) => s + (p.source === "uchet" ? sums[i] : 0), 0) };
}

async function loadThreshold(today: string, since: string | null, locations: string[]): Promise<Threshold> {
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const known = Object.keys(INCOME_LIMIT_BY_YEAR).map(Number).sort((a, b) => a - b);
  const limitKnown = year in INCOME_LIMIT_BY_YEAR;
  const limit = INCOME_LIMIT_BY_YEAR[year] ?? INCOME_LIMIT_BY_YEAR[known.filter((y) => y <= year).pop() ?? known[0]];

  const paceDays = 90;
  const paceFrom = addDays(today, -(paceDays - 1));

  const [extraRow, ytd, site, pace, sitePace, monthly] = await Promise.all([
    getSupabaseAdmin().from("summary_income_extra").select("amount, note").eq("year", year).maybeSingle(),
    receivedBetween(yearStart, today, since, locations),
    sitePaid(yearStart, today),
    receivedBetween(paceFrom, today, since, locations),
    sitePaid(paceFrom, today),
    // Помесячно — чтобы сказать, в каком месяце порог пройден.
    Promise.all(
      splitBySource(yearStart, today, since).map((p) =>
        p.source === "posiflora" ? posifloraMonthly(p.from, p.to) : loadUchetBlock(p.from, p.to, locations).then((b) => toMonths(b.series.points))
      )
    ).then((lists) => toMonths(lists.flat())),
  ]);
  if (extraRow.error) throw new Error(`Доход вне систем: ${extraRow.error.message}`);

  const extra = { amount: num(extraRow.data?.amount), note: extraRow.data?.note ?? null };
  const income = ytd.posiflora + ytd.uchet + site.amount + extra.amount;

  const historyFrom = monthly.find((m) => m.revenue > 0)?.date.slice(0, 7) ?? null;
  const needsExtra = extra.amount === 0 && (!historyFrom || historyFrom > `${year}-01`);

  // Темп — по последним 90 дням: в нём и будни, и праздники, а сезон
  // года целиком (14 февраля, 8 марта) на остаток года не переносится.
  const pacePerDay = (pace.posiflora + pace.uchet + sitePace.amount) / paceDays;
  const yearEnd = `${year}-12-31`;
  const daysLeft = Math.max(0, daysIn(today, yearEnd) - 1);
  const forecast = income + pacePerDay * daysLeft;

  // Когда пройден: доход «до истории» считаем пришедшим до неё, дальше
  // копим помесячно. Точнее месяца по этим данным не сказать — и не нужно:
  // НДС начинается с 1-го числа следующего месяца.
  let crossedMonth: string | null = null;
  if (income > limit) {
    let acc = extra.amount;
    if (acc > limit) crossedMonth = historyFrom ? prevMonth(historyFrom) : `${year}-01`;
    for (const m of monthly) {
      if (crossedMonth) break;
      acc += m.revenue + (site.byMonth.get(m.date.slice(0, 7)) ?? 0);
      if (acc > limit) crossedMonth = m.date.slice(0, 7);
    }
    crossedMonth ??= today.slice(0, 7);
  }

  let crossDate: string | null = null;
  if (!crossedMonth && pacePerDay > 0) {
    const d = addDays(today, Math.ceil((limit - income) / pacePerDay));
    if (d <= yearEnd) crossDate = d;
  }
  const over = crossedMonth ?? crossDate?.slice(0, 7) ?? null;
  const vatFrom = over ? `${nextMonth(over)}-01` : null;

  const parts = [
    { label: "Posiflora", amount: ytd.posiflora },
    { label: "Учёт", amount: ytd.uchet },
    { label: "Сайт, оплата онлайн", amount: site.amount },
    { label: "Вне систем (вписано вручную)", amount: extra.amount },
  ].filter((p) => p.amount > 0 || p.label === "Posiflora");

  return { year, limit, limitKnown, income, parts, extra, historyFrom, needsExtra, pacePerDay, paceDays, forecast, crossedMonth, crossDate, vatFrom };
}

// ---------------------------------------------------------------
// Всё вместе
// ---------------------------------------------------------------

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function loadSummary(period: Period): Promise<Summary> {
  const today = studioDate(0);
  const { data: settings, error } = await getSupabaseAdmin()
    .from("pos_settings")
    .select("posiflora_payment_names, summary_uchet_since")
    .eq("id", true)
    .maybeSingle();
  if (error || !settings) throw new Error(`Настройки сводки: ${error?.message ?? "нет строки"}`);
  const names = (settings.posiflora_payment_names ?? {}) as Record<string, string>;
  const since = (settings.summary_uchet_since as string | null) ?? null;
  // Настоящее место «Магазин» есть с самого начала, просто до запуска
  // основное — «Тренировка». Запущен учёт = основное место не тренировочное.
  const [locations, main] = await Promise.all([realLocationIds(), getDefaultLocation()]);

  const parts = splitBySource(period.from, period.to, since);
  const [blocks, site, reconcile, threshold] = await Promise.all([
    Promise.all(
      parts.map(async (p): Promise<SourceBlock | FailedBlock> => {
        try {
          return p.source === "posiflora" ? await loadPosifloraBlock(p.from, p.to, names) : await loadUchetBlock(p.from, p.to, locations);
        } catch (e) {
          console.error(`[svodka] ${p.source} ${p.from}…${p.to}:`, message(e));
          return { ...p, error: message(e) };
        }
      })
    ),
    sitePaid(period.from, period.to),
    // Параллельная работа: учёт запущен, но сводка ещё по Posiflora.
    parts.some((p) => p.source === "posiflora") && locations.length
      ? loadUchetBlock(period.from, since && since <= period.to ? addDays(since, -1) : period.to, locations).then((b) => (b.checks ? { revenue: b.revenue, checks: b.checks } : null))
      : Promise.resolve(null),
    loadThreshold(today, since, locations).catch((e) => {
      console.error("[svodka] порог:", message(e));
      return { error: message(e) };
    }),
  ]);

  return { period, today, blocks, site: { count: site.count, amount: site.amount }, reconcile, threshold, uchetSince: since, canSwitch: !main.isTraining };
}
