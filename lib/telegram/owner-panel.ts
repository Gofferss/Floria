import { getSupabaseAdmin } from "@/lib/supabase";
import { dayStart, studioDate } from "@/lib/uchet/order-queries";
import { loadSummary, resolvePeriod, type SourceBlock, type Summary } from "@/lib/uchet/summary";
import {
  answerCallbackQuery,
  answerWidgetQuery,
  editMessageText,
  escapeTelegramHtml as esc,
  pinChatMessage,
  sendMessage,
  sendWidget,
  unpinChatMessage,
  type InlineKeyboardMarkup,
} from "@/lib/telegram/bot";
import { OWNER_PANEL_HTML } from "@/lib/telegram/owner-panel-html";
import { noteWidgetFailure, widgetsLikelyAllowed } from "@/lib/telegram/widget-availability";

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

type OrderRow = [string, string, string, string, string, number];

/** Ближайшие активные заказы: [когда, №, имя, этап, сумма, оплачен]. */
async function orderRows(limit: number): Promise<{ rows: OrderRow[]; total: number }> {
  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select("order_number, status, payment_status, delivery_date, delivery_time_from, customer_name, total_amount")
    .in("status", ACTIVE)
    .order("delivery_date", { ascending: true })
    .order("delivery_time_from", { ascending: true, nullsFirst: false })
    .limit(60);
  if (error) throw new Error(error.message);
  const all = (data ?? []).map((o): OrderRow => [
    `${dayLabel(o.delivery_date as string)}${o.delivery_time_from ? ` ${(o.delivery_time_from as string).slice(0, 5)}` : ""}`,
    `№…${(o.order_number as string).slice(-5)}`,
    ((o.customer_name as string | null) ?? "—").trim().split(/\s+/)[0].slice(0, 20),
    STAGE[o.status as string] ?? (o.status as string),
    rub(Number(o.total_amount)),
    o.payment_status === "paid" ? 1 : 0,
  ]);
  return { rows: all.slice(0, limit), total: all.length };
}

async function orders(): Promise<string> {
  const { rows, total } = await orderRows(6);
  let shown = rows.length;
  return fit(
    () => ({ t: "orders", at: now(), o: rows.slice(0, shown), m: total - shown }),
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
// Панель сообщением с кнопками — пока Telegram не пускает бота к виджетам
// (widget-availability.ts). Те же вкладки и данные; нажатие на кнопку
// переписывает это же сообщение.
// ---------------------------------------------------------------

const TAB_LABEL: Record<Tab, string> = { today: "Сегодня", orders: "Заказы", money: "Деньги" };
const TODAY_ICON = ["🆕", "🌸", "🚗", "❗️"];

function keyboard(tab: Tab): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      TABS.map((t) => ({ text: t === tab ? `· ${TAB_LABEL[t]} ·` : TAB_LABEL[t], callback_data: `panel:${t}` })),
      [{ text: "🔄 Обновить", callback_data: `panel:${tab}` }],
    ],
  };
}

function header(title: string, at: string | undefined): string {
  return `<b>${esc(title)}</b>${at ? `  <i>на ${esc(at)}</i>` : ""}`;
}

function bar(percent: number): string {
  const full = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return "▰".repeat(full) + "▱".repeat(10 - full);
}

type TodayData = { at: string; k: [string, number, number][]; l: string[] };
type MoneyData = { at: string; r?: [string, string, string][]; th?: { p: number; a: string; f: string } | null; err?: string };

function todayText(d: TodayData): string {
  return [
    header("Флория · сегодня", d.at),
    "",
    ...d.k.map(([label, n], i) => `${i === 3 && n === 0 ? "✅" : TODAY_ICON[i]} ${esc(label)}: <b>${n}</b>`),
    "",
    ...d.l.map(esc),
  ].join("\n");
}

function ordersText(rows: OrderRow[], total: number): string {
  if (!rows.length) return `${header("Ближайшие заказы", now())}\n\nАктивных заказов нет.`;
  return [
    header("Ближайшие заказы", now()),
    "",
    ...rows.map(
      ([when, num, name, stage, sum, paid]) =>
        `• <b>${esc(when)}</b> — ${esc(name)} · ${esc(stage)} · ${esc(sum)}${paid ? "" : " · <b>не оплачен</b>"} <i>${esc(num)}</i>`
    ),
    ...(total > rows.length ? ["", `и ещё ${total - rows.length}`] : []),
  ].join("\n");
}

function moneyText(d: MoneyData): string {
  if (!d.r) return `${header("Деньги", d.at)}\n\n⚠️ ${esc(d.err ?? "Нет данных")}`;
  const lines = [header("Деньги", d.at), "", ...d.r.map(([label, value, note]) => `${esc(label)}: <b>${esc(value)}</b>${note ? ` · ${esc(note)}` : ""}`)];
  if (d.th) lines.push("", `<b>Порог 20 млн:</b> ${esc(d.th.a)} (${d.th.p}%)`, bar(d.th.p), esc(d.th.f));
  if (d.err) lines.push("", `⚠️ ${esc(d.err)}`);
  return lines.join("\n");
}

async function panelText(tab: Tab): Promise<string> {
  try {
    if (tab === "orders") {
      const { rows, total } = await orderRows(15);
      return ordersText(rows, total);
    }
    const data = JSON.parse(await BUILD[tab]());
    return tab === "today" ? todayText(data as TodayData) : moneyText(data as MoneyData);
  } catch (e) {
    console.error(`[owner-panel] вкладка ${tab}:`, e);
    return `${header(TAB_LABEL[tab], now())}\n\n⚠️ Не удалось получить данные — нажмите «Обновить».`;
  }
}

// ---------------------------------------------------------------
// Отправка и ответы
// ---------------------------------------------------------------

/**
 * Прислать панель в чат и закрепить; прежняя панель этого чата открепляется
 * и перестаёт отвечать. Сначала пробуем живую карточку (виджет); Telegram не
 * пустил — сообщение с кнопками.
 */
export async function sendOwnerPanel(chatId: number): Promise<{ messageId: number; kind: "widget" | "text" }> {
  const admin = getSupabaseAdmin();
  const { data: old } = await admin.from("bot_panels").select("message_id").eq("chat_id", chatId).maybeSingle();

  let sent: { messageId: number; kind: "widget" | "text" } | null = null;
  if (widgetsLikelyAllowed()) {
    try {
      const msg = await sendWidget({
        chatId,
        html: OWNER_PANEL_HTML,
        chatData: await today(),
        caption: "Панель студии: сегодня, заказы, деньги. Обновляется, когда открываете. Прислать заново — /panel",
        disableNotification: true,
        allowQueries: true,
      });
      sent = { messageId: msg.message_id, kind: "widget" };
    } catch (e) {
      noteWidgetFailure(e);
      console.warn("[owner-panel] Telegram не принял виджет — присылаю сообщение с кнопками:", e);
    }
  }
  if (!sent) {
    const msg = await sendMessage(chatId, await panelText("today"), keyboard("today"));
    sent = { messageId: msg.message_id, kind: "text" };
  }

  const { error } = await admin
    .from("bot_panels")
    .upsert({ chat_id: chatId, message_id: sent.messageId }, { onConflict: "chat_id" });
  if (error) throw new Error(`панель отправлена, но не записана — отвечать ей не смогу: ${error.message}`);
  try {
    await pinChatMessage(chatId, sent.messageId);
    if (old?.message_id) await unpinChatMessage(chatId, Number(old.message_id));
  } catch (e) {
    console.error("[owner-panel] не закрепилась:", e);
  }
  return sent;
}

/** Нажатие кнопки панели («panel:today» и т.п.). Только на записанной панели этого чата. */
export async function handlePanelCallback(cb: { id: string; data: string; chatId: number; messageId: number }): Promise<void> {
  const { data: panel, error } = await getSupabaseAdmin()
    .from("bot_panels")
    .select("message_id")
    .eq("chat_id", cb.chatId)
    .maybeSingle();
  if (error) {
    await answerCallbackQuery(cb.id, "Не удалось проверить доступ — нажмите ещё раз");
    return;
  }
  if (!panel || Number(panel.message_id) !== cb.messageId) {
    await answerCallbackQuery(cb.id, "Эта панель устарела — напишите /panel");
    return;
  }
  const asked = cb.data.slice("panel:".length);
  const tab: Tab = (TABS as string[]).includes(asked) ? (asked as Tab) : "today";
  // Ответ на нажатие — сразу (иначе крутится часик), считаем после.
  await answerCallbackQuery(cb.id, tab === "money" ? "Считаю…" : undefined);
  try {
    await editMessageText(cb.chatId, cb.messageId, await panelText(tab), keyboard(tab));
  } catch (e) {
    if (!/not modified/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
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
