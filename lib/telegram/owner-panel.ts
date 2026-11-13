import { getSupabaseAdmin } from "@/lib/supabase";
import { dayStart, studioDate } from "@/lib/uchet/order-queries";
import { loadSummary, resolvePeriod, type SourceBlock, type Summary } from "@/lib/uchet/summary";
import { answerWidgetQuery, pinChatMessage, sendWidget, unpinChatMessage } from "@/lib/telegram/bot";
import { OWNER_PANEL_HTML } from "@/lib/telegram/owner-panel-html";

// ================================================================
// Панель владельца в Telegram: «Сегодня / Заказы / Деньги».
//
// Карточка (owner-panel-html.ts) спрашивает бота при открытии и по
// нажатию на вкладку; бот отвечает здесь. Отвечаем ТОЛЬКО карточке,
// записанной в bot_panels (чат + сообщение): прислать её может лишь
// сервер — по задаче с секретом или по /panel из уже записанного чата.
// Поэтому выручку и прибыль видит только владелец.
//
// Заказы — с сайта (заказы магазина появятся, когда запустим учёт);
// деньги — та же «Сводка», что в учёте (Posiflora + учёт, с кэшем).
// ================================================================

type Tab = "today" | "orders" | "money";
const TABS: Tab[] = ["today", "orders", "money"];
const ACTIVE = ["new", "confirmed", "assembling", "ready", "delivering"];
const STAGE: Record<string, string> = {
  new: "новый",
  confirmed: "подтверждён",
  assembling: "собираем",
  ready: "готов",
  delivering: "в пути",
};
const MAX_BYTES = 1000;
/** Telegram ждёт ответа 15 секунд; Posiflora бывает медленной. */
const MONEY_TIMEOUT_MS = 11_000;

const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Simferopol" });
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

const MONTH_IN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;
const mln = (n: number) => (n / 1_000_000).toFixed(1).replace(".", ",");
const now = () => timeFmt.format(new Date());

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

function dayLabel(date: string): string {
  if (date === studioDate(0)) return "сегодня";
  if (date === studioDate(1)) return "завтра";
  return dayMonthFmt.format(new Date(`${date}T00:00:00Z`)).replace(".", "");
}

/** JSON ответа не длиннее лимита Telegram: лишнее срезает shrink. */
function fit<T>(build: () => T, shrink: () => boolean): string {
  let json = JSON.stringify(build());
  while (Buffer.byteLength(json, "utf8") > MAX_BYTES && shrink()) json = JSON.stringify(build());
  return json;
}

// ---------------------------------------------------------------
// Вкладки
// ---------------------------------------------------------------

async function today(): Promise<string> {
  const admin = getSupabaseAdmin();
  const day = studioDate(0);
  const [active, created, contacts] = await Promise.all([
    admin.from("orders").select("status, payment_status, delivery_date, delivery_time_from").in("status", ACTIVE).limit(500),
    admin.from("orders").select("id", { count: "exact", head: true }).gte("created_at", dayStart(day)),
    admin.from("contact_requests").select("id", { count: "exact", head: true }).is("handled_at", null),
  ]);
  for (const r of [active, created, contacts]) if (r.error) throw new Error(r.error.message);

  const rows = active.data ?? [];
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const unpaid = count((r) => r.payment_status !== "paid");
  const todays = rows.filter((r) => r.delivery_date === day);
  const next = todays
    .map((r) => (r.delivery_time_from as string | null)?.slice(0, 5))
    .filter((t): t is string => !!t)
    .sort()[0];
  const contactCount = contacts.count ?? 0;

  return JSON.stringify({
    t: "today",
    at: now(),
    k: [
      ["Новые", count((r) => r.status === "new"), 0],
      ["В работе", count((r) => ["confirmed", "assembling", "ready"].includes(r.status as string)), 0],
      ["В пути", count((r) => r.status === "delivering"), 0],
      ["Не оплачено", unpaid, unpaid > 0 ? 1 : 0],
    ],
    l: [
      todays.length
        ? `Сегодня ${todays.length} ${plural(todays.length, "заказ", "заказа", "заказов")} к выдаче${next ? `, ближайший в ${next}` : ""}`
        : "На сегодня заказов к выдаче нет",
      `С сайта за сегодня: ${created.count ?? 0}`,
      contactCount ? `Обращений без ответа: ${contactCount}` : "Все обращения разобраны",
    ],
  });
}

async function orders(): Promise<string> {
  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select("order_number, status, payment_status, delivery_date, delivery_time_from, customer_name, total_amount")
    .in("status", ACTIVE)
    .order("delivery_date", { ascending: true })
    .order("delivery_time_from", { ascending: true, nullsFirst: false })
    .limit(40);
  if (error) throw new Error(error.message);
  const all = (data ?? []).map((o) => [
    `${dayLabel(o.delivery_date as string)}${o.delivery_time_from ? ` ${(o.delivery_time_from as string).slice(0, 5)}` : ""}`,
    `№…${(o.order_number as string).slice(-5)}`,
    ((o.customer_name as string | null) ?? "—").trim().split(/\s+/)[0].slice(0, 20),
    STAGE[o.status as string] ?? (o.status as string),
    rub(Number(o.total_amount)),
    o.payment_status === "paid" ? 1 : 0,
  ]);
  let shown = Math.min(all.length, 6);
  return fit(
    () => ({ t: "orders", at: now(), o: all.slice(0, shown), m: all.length - shown }),
    () => --shown > 0
  );
}

function sumBlocks(s: Summary): { revenue: number; checks: number; profit: number | null; failed: boolean } {
  const ok = s.blocks.filter((b): b is SourceBlock => !("error" in b));
  const profits = ok.map((b) => b.profit);
  return {
    revenue: ok.reduce((a, b) => a + b.revenue, 0),
    checks: ok.reduce((a, b) => a + b.checks, 0),
    profit: profits.some((p) => p === null) ? null : profits.reduce<number>((a, p) => a + (p ?? 0), 0),
    failed: ok.length < s.blocks.length,
  };
}

async function money(): Promise<string> {
  const work = Promise.all([loadSummary(resolvePeriod({ p: "today" })), loadSummary(resolvePeriod({}))]);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), MONEY_TIMEOUT_MS));
  const result = await Promise.race([work, timeout]);
  if (!result) {
    // Считаться продолжит в фоне и ляжет в кэш — повторное нажатие будет быстрым.
    work.catch(() => undefined);
    return JSON.stringify({ t: "money", at: now(), err: "Posiflora отвечает долго — нажмите «Деньги» ещё раз через минуту" });
  }
  const [d, m] = result;
  const td = sumBlocks(d);
  const mo = sumBlocks(m);
  const r: [string, string, string][] = [
    ["Сегодня", rub(td.revenue), `${td.checks} ${plural(td.checks, "чек", "чека", "чеков")}`],
    [m.period.title, rub(mo.revenue), mo.profit !== null ? `прибыль ${rub(mo.profit)}` : `${mo.checks} ${plural(mo.checks, "чек", "чека", "чеков")}`],
  ];
  if (mo.checks > 0) r.push(["Средний чек", rub(mo.revenue / mo.checks), "за месяц"]);
  if (m.site.count > 0) r.push(["С сайта", rub(m.site.amount), `${m.site.count} ${plural(m.site.count, "заказ", "заказа", "заказов")} за месяц`]);

  let th: { p: number; a: string; f: string } | null = null;
  if (!("error" in m.threshold)) {
    const t = m.threshold;
    const when = (iso: string | null) => (iso ? dayMonthFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)).replace(".", "") : null);
    const parts = [
      t.crossedMonth
        ? `порог пройден в ${MONTH_IN[Number(t.crossedMonth.slice(5, 7)) - 1] ?? t.crossedMonth}`
        : `прогноз на год ${mln(t.forecast)} млн`,
      !t.crossedMonth && when(t.crossDate) ? `порог ~${when(t.crossDate)}` : null,
      when(t.vatFrom) ? `НДС с ${when(t.vatFrom)}` : null,
    ].filter(Boolean);
    th = { p: Math.round((t.income / t.limit) * 100), a: `${mln(t.income)} из ${mln(t.limit)} млн`, f: parts.join(" · ") };
  }
  const failed = td.failed || mo.failed;
  return JSON.stringify({ t: "money", at: now(), r, th, err: failed ? "Часть данных не загрузилась — цифры могут быть неполными" : undefined });
}

const BUILD: Record<Tab, () => Promise<string>> = { today, orders, money };

// ---------------------------------------------------------------
// Отправка и ответы
// ---------------------------------------------------------------

/** Прислать панель в чат и закрепить; прежняя панель этого чата открепляется и перестаёт отвечать. */
export async function sendOwnerPanel(chatId: number): Promise<{ messageId: number }> {
  const admin = getSupabaseAdmin();
  const { data: old } = await admin.from("bot_panels").select("message_id").eq("chat_id", chatId).maybeSingle();
  const msg = await sendWidget({
    chatId,
    html: OWNER_PANEL_HTML,
    chatData: await today(),
    caption: "Панель студии: сегодня, заказы, деньги. Обновляется, когда открываете. Прислать заново — /panel",
    disableNotification: true,
    allowQueries: true,
  });
  const { error } = await admin
    .from("bot_panels")
    .upsert({ chat_id: chatId, message_id: msg.message_id }, { onConflict: "chat_id" });
  if (error) throw new Error(`панель отправлена, но не записана — отвечать ей не смогу: ${error.message}`);
  try {
    await pinChatMessage(chatId, msg.message_id);
    if (old?.message_id) await unpinChatMessage(chatId, Number(old.message_id));
  } catch (e) {
    console.error("[owner-panel] не закрепилась:", e);
  }
  return { messageId: msg.message_id };
}

/** Записан ли чат как чат владельца (для команды /panel). */
export async function isPanelChat(chatId: number): Promise<boolean> {
  const { data } = await getSupabaseAdmin().from("bot_panels").select("chat_id").eq("chat_id", chatId).maybeSingle();
  return !!data;
}

export type WidgetQuery = {
  id: string;
  from: { id: number };
  chat?: { id: number };
  message_id?: number;
  data?: string;
};

/** Ответить на запрос карточки. Не наша карточка — данных не даём. */
export async function answerPanelQuery(q: WidgetQuery): Promise<void> {
  let answer: string;
  const { data: panel, error } = q.chat
    ? await getSupabaseAdmin().from("bot_panels").select("message_id").eq("chat_id", q.chat.id).maybeSingle()
    : { data: null, error: null };
  if (error) {
    answer = JSON.stringify({ err: "Не удалось проверить доступ — нажмите ещё раз" });
  } else if (!panel || Number(panel.message_id) !== q.message_id) {
    answer = JSON.stringify({ err: "Эта панель устарела — напишите боту /panel" });
  } else {
    const tab = (TABS as string[]).includes(q.data ?? "") ? (q.data as Tab) : "today";
    try {
      answer = await BUILD[tab]();
    } catch (e) {
      console.error(`[owner-panel] вкладка ${tab}:`, e);
      answer = JSON.stringify({ t: tab, at: now(), err: "Не удалось получить данные — нажмите ещё раз" });
    }
  }
  await answerWidgetQuery(q.id, answer);
}
