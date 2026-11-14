import { getSupabaseAdmin } from "@/lib/supabase";
import { editMessageWidgetData, sendWidget } from "@/lib/telegram/bot";
import { ORDER_WIDGET_HTML } from "@/lib/telegram/order-widget-html";
import { noteWidgetFailure, widgetsLikelyAllowed } from "@/lib/telegram/widget-availability";

// ================================================================
// Живая карточка заказа у клиента в Telegram.
//
// При оформлении бот присылает карточку вместо обычного «Спасибо, приняли»
// (текст — её подпись, его видят и старые версии Telegram). Дальше при каждой
// смене этапа, оплате или отмене карточка перерисовывается молча через
// editMessageWidgetData. Звук по-прежнему дают обычные сообщения о важных
// этапах (order-notify.ts) — правка карточки уведомления не присылает.
//
// Куда прислали — в orders.customer_widget_chat_id / _message_id (044).
// Сбой карточки ничего не ломает: заказ и статус уже в базе, а тексты
// уходят как раньше. Поэтому ошибки только пишутся в журнал.
// ================================================================

/** Владелец посмотрел пример и включил (14.11.2026). */
const LAUNCHED = true;
/** Аварийный выключатель без выкладки кода: TELEGRAM_ORDER_WIDGETS=off в Coolify. */
export const ORDER_WIDGETS_ENABLED = LAUNCHED && process.env.TELEGRAM_ORDER_WIDGETS !== "off";

const MAX_DATA_BYTES = 1000;
const MAX_ITEMS = 4;

type WidgetOrder = {
  id: string;
  order_number: string;
  status: string;
  is_pickup: boolean;
  delivery_date: string | null;
  delivery_time_from: string | null;
  delivery_time_to: string | null;
  delivery_address: string | null;
  delivery_apartment: string | null;
  total_amount: number | string;
  payment_status: string;
  customer_widget_chat_id: number | null;
  customer_widget_message_id: number | null;
  order_items: { product_name: string; quantity: number }[] | null;
};

const SELECT =
  "id, order_number, status, is_pickup, delivery_date, delivery_time_from, delivery_time_to, delivery_address, delivery_apartment, " +
  "total_amount, payment_status, customer_widget_chat_id, customer_widget_message_id, order_items(product_name, quantity)";

const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });

function cut(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function money(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;
}

/** Данные карточки: готовые строки, не больше 1000 байт. */
export function buildOrderWidgetData(o: Omit<WidgetOrder, "id" | "customer_widget_chat_id" | "customer_widget_message_id">): string {
  const when = [
    o.delivery_date ? dayFmt.format(new Date(`${o.delivery_date}T00:00:00Z`)) : null,
    o.delivery_time_from && o.delivery_time_to ? `${o.delivery_time_from.slice(0, 5)}–${o.delivery_time_to.slice(0, 5)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const address = o.is_pickup
    ? ""
    : cut(`${o.delivery_address ?? ""}${o.delivery_apartment ? `, кв. ${o.delivery_apartment}` : ""}`, 80);
  const items = (o.order_items ?? []).map((it) => `${cut(it.product_name, 56)} × ${it.quantity}`);
  let lines = items.length > MAX_ITEMS ? [...items.slice(0, MAX_ITEMS - 1), `и ещё ${items.length - (MAX_ITEMS - 1)}`] : items;

  const make = () =>
    JSON.stringify({
      n: o.order_number,
      s: o.status,
      p: o.is_pickup ? 1 : 0,
      w: when,
      a: address,
      i: lines,
      t: money(Number(o.total_amount)),
      pd: o.payment_status === "paid" ? 1 : 0,
    });
  let data = make();
  // Длинный состав — сокращаем строки, пока не влезет в лимит Telegram.
  while (Buffer.byteLength(data, "utf8") > MAX_DATA_BYTES && lines.length > 1) {
    lines = [...lines.slice(0, -2), `и ещё ${items.length - lines.length + 2}`];
    data = make();
  }
  return data;
}

async function loadOrder(orderId: string): Promise<WidgetOrder | null> {
  const { data, error } = await getSupabaseAdmin().from("orders").select(SELECT).eq("id", orderId).maybeSingle();
  if (error) throw new Error(`заказ ${orderId}: ${error.message}`);
  return (data as unknown as WidgetOrder) ?? null;
}

/**
 * Прислать карточку с подписью caption (HTML). Возвращает false, если карточку
 * отправить не вышло — тогда вызывающий шлёт обычный текст.
 */
export async function sendOrderWidget(orderId: string, chatId: number, caption: string): Promise<boolean> {
  if (!ORDER_WIDGETS_ENABLED || !widgetsLikelyAllowed()) return false;
  try {
    const order = await loadOrder(orderId);
    if (!order) return false;
    const msg = await sendWidget({ chatId, html: ORDER_WIDGET_HTML, chatData: buildOrderWidgetData(order), caption });
    const { error } = await getSupabaseAdmin()
      .from("orders")
      .update({ customer_widget_chat_id: chatId, customer_widget_message_id: msg.message_id })
      .eq("id", orderId);
    // Карточка у клиента есть, но обновлять её не сможем — пусть хоть будет.
    if (error) console.error(`[order-widget] заказ ${order.order_number}: не записал, куда отправлена карточка:`, error.message);
    return true;
  } catch (error) {
    noteWidgetFailure(error);
    console.error(`[order-widget] заказ ${orderId}: карточка не отправилась:`, error);
    return false;
  }
}

/** Перерисовать карточку по текущему состоянию заказа. Нет карточки — ничего не делает. */
export async function refreshOrderWidget(orderId: string): Promise<void> {
  if (!ORDER_WIDGETS_ENABLED) return;
  try {
    const order = await loadOrder(orderId);
    if (!order?.customer_widget_chat_id || !order.customer_widget_message_id) return;
    await editMessageWidgetData(order.customer_widget_chat_id, order.customer_widget_message_id, buildOrderWidgetData(order));
  } catch (error) {
    console.error(`[order-widget] заказ ${orderId}: карточка не обновилась:`, error);
  }
}
