import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Заказы для учёта: что собрать и отвезти — по дням.
//
// Два источника на одной доске: заказы сайта (orders) и заказы магазина
// (pos_orders, миграция 029). С сайта в работу попадают оплаченные:
// неоплаченный заказ с сайта — это чаще всего брошенная корзина (оплата
// онлайн обязательна), такие идут отдельным свёрнутым списком. Заказ
// магазина в работе всегда: платят по-разному, в том числе при получении.
// ================================================================

export type WorkOrderStatus = "new" | "confirmed" | "assembling" | "ready" | "delivering" | "completed" | "cancelled";

export type WorkOrder = {
  id: string;
  /** site — заказ с сайта (orders), shop — заказ магазина (pos_orders). */
  source: "site" | "shop";
  number: string;
  status: WorkOrderStatus;
  /** Оплачен целиком. */
  paid: boolean;
  /** Сколько уже внесено. У заказа сайта — всё или ничего. */
  paidAmount: number;
  /** Что собрать — у заказов магазина. */
  wishes: string | null;
  /** Откуда пришёл: site, shop, phone, messenger, other. */
  channel: string;
  isPickup: boolean;
  date: string;
  timeFrom: string | null;
  timeTo: string | null;
  address: string | null;
  addressExtra: string | null;
  recipientName: string;
  recipientPhone: string;
  customerName: string;
  customerPhone: string;
  isRecipientSelf: boolean;
  cardText: string | null;
  courierComment: string | null;
  adminComment: string | null;
  total: number;
  floristAcceptedAt: string | null;
  photos: string[];
  photosSentAt: string | null;
  items: { name: string; qty: number }[];
};

const ACTIVE: WorkOrderStatus[] = ["new", "confirmed", "assembling", "ready", "delivering"];

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" });

/** «2026-10-22» по Симферополю, со сдвигом в днях. */
export function studioDate(offsetDays = 0): string {
  return dayFmt.format(new Date(Date.now() + offsetDays * 86_400_000));
}

// ---------------------------------------------------------------
// Заказы сайта
// ---------------------------------------------------------------

type Row = {
  id: string;
  order_number: string;
  status: WorkOrderStatus;
  payment_status: string;
  is_pickup: boolean;
  delivery_date: string;
  delivery_time_from: string | null;
  delivery_time_to: string | null;
  delivery_address: string | null;
  delivery_apartment: string | null;
  delivery_entrance: string | null;
  delivery_floor: string | null;
  delivery_intercom_code: string | null;
  recipient_name: string;
  recipient_phone: string;
  customer_name: string;
  customer_phone: string;
  is_recipient_self: boolean;
  card_text: string | null;
  courier_comment: string | null;
  admin_comment: string | null;
  total_amount: number | string;
  florist_accepted_at: string | null;
  assembled_photos: string[] | null;
  assembled_photo_sent_at: string | null;
  order_items: { product_name: string; quantity: number }[] | null;
};

const SELECT =
  "id, order_number, status, payment_status, is_pickup, delivery_date, delivery_time_from, delivery_time_to, delivery_address, " +
  "delivery_apartment, delivery_entrance, delivery_floor, delivery_intercom_code, recipient_name, recipient_phone, customer_name, " +
  "customer_phone, is_recipient_self, card_text, courier_comment, admin_comment, total_amount, florist_accepted_at, assembled_photos, " +
  "assembled_photo_sent_at, order_items(product_name, quantity)";

function toWorkOrder(r: Row): WorkOrder {
  const extra = [
    r.delivery_apartment && `кв. ${r.delivery_apartment}`,
    r.delivery_entrance && `подъезд ${r.delivery_entrance}`,
    r.delivery_floor && `этаж ${r.delivery_floor}`,
    r.delivery_intercom_code && `домофон ${r.delivery_intercom_code}`,
  ]
    .filter(Boolean)
    .join(", ");
  const total = Number(r.total_amount) || 0;
  return {
    id: r.id,
    source: "site",
    number: r.order_number,
    status: r.status,
    paid: r.payment_status === "paid",
    paidAmount: r.payment_status === "paid" ? total : 0,
    wishes: null,
    channel: "site",
    isPickup: r.is_pickup,
    date: r.delivery_date,
    timeFrom: r.delivery_time_from?.slice(0, 5) ?? null,
    timeTo: r.delivery_time_to?.slice(0, 5) ?? null,
    address: r.delivery_address,
    addressExtra: extra || null,
    recipientName: r.recipient_name,
    recipientPhone: r.recipient_phone,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    isRecipientSelf: r.is_recipient_self,
    cardText: r.card_text,
    courierComment: r.courier_comment,
    adminComment: r.admin_comment,
    total,
    floristAcceptedAt: r.florist_accepted_at,
    photos: r.assembled_photos ?? [],
    photosSentAt: r.assembled_photo_sent_at,
    items: (r.order_items ?? []).map((i) => ({ name: i.product_name, qty: i.quantity })),
  };
}

// ---------------------------------------------------------------
// Заказы магазина
// ---------------------------------------------------------------

type ShopRow = {
  id: string;
  order_no: string;
  status: WorkOrderStatus;
  channel: string;
  customer_name: string | null;
  customer_phone: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  is_pickup: boolean;
  delivery_address: string | null;
  delivery_details: string | null;
  delivery_date: string;
  time_from: string | null;
  time_to: string | null;
  card_text: string | null;
  wishes: string | null;
  courier_comment: string | null;
  total: number | string;
  pos_bouquets: { title: string; photo_urls: string[] | null; status: string }[] | null;
  pos_sale_lines: { amount: number | string; pos_sales: { status: string } | { status: string }[] | null }[] | null;
};

const SHOP_SELECT =
  "id, order_no, status, channel, customer_name, customer_phone, recipient_name, recipient_phone, is_pickup, delivery_address, " +
  "delivery_details, delivery_date, time_from, time_to, card_text, wishes, courier_comment, total, " +
  "pos_bouquets(title, photo_urls, status), pos_sale_lines(amount, pos_sales(status))";

function toShopOrder(r: ShopRow): WorkOrder {
  const total = Number(r.total) || 0;
  // Оплачено — по чекам, которые не вернули (так же считает pos_order_paid).
  const paidAmount = (r.pos_sale_lines ?? [])
    .filter((l) => (Array.isArray(l.pos_sales) ? l.pos_sales[0] : l.pos_sales)?.status === "paid")
    .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const bouquets = (r.pos_bouquets ?? []).filter((b) => b.status === "order" || b.status === "sold");
  return {
    id: r.id,
    source: "shop",
    number: r.order_no,
    status: r.status,
    paid: paidAmount >= total,
    paidAmount,
    wishes: r.wishes,
    channel: r.channel,
    isPickup: r.is_pickup,
    date: r.delivery_date,
    timeFrom: r.time_from?.slice(0, 5) ?? null,
    timeTo: r.time_to?.slice(0, 5) ?? null,
    address: r.delivery_address,
    addressExtra: r.delivery_details,
    recipientName: r.recipient_name ?? r.customer_name ?? "—",
    recipientPhone: r.recipient_phone ?? r.customer_phone ?? "",
    customerName: r.customer_name ?? "—",
    customerPhone: r.customer_phone ?? "",
    isRecipientSelf: !r.recipient_phone || r.recipient_phone === r.customer_phone,
    cardText: r.card_text,
    courierComment: r.courier_comment,
    adminComment: null,
    total,
    floristAcceptedAt: null,
    photos: bouquets.flatMap((b) => b.photo_urls ?? []),
    photosSentAt: null,
    items: bouquets.map((b) => ({ name: b.title, qty: 1 })),
  };
}

const byTime = (a: WorkOrder, b: WorkOrder) =>
  (a.date + (a.timeFrom ?? "00:00")).localeCompare(b.date + (b.timeFrom ?? "00:00"));

// ---------------------------------------------------------------

/**
 * Заказы в работе: все незавершённые, плюс завершённые сегодня — чтобы
 * было видно, что уже отвезли. Отменённые и старые завершённые — в
 * админке сайта и в истории.
 *
 * Заказы магазина — только текущего места: пока учёт не запущен, это
 * «Тренировка», и пробные заказы не смешиваются с настоящими.
 */
export async function listWorkOrders(
  locationId: string
): Promise<{ work: WorkOrder[]; awaitingPayment: WorkOrder[]; doneToday: WorkOrder[] }> {
  const admin = getSupabaseAdmin();
  const today = studioDate(0);
  const [active, done, shopActive, shopDone] = await Promise.all([
    admin.from("orders").select(SELECT).in("status", ACTIVE).limit(300),
    admin.from("orders").select(SELECT).eq("status", "completed").eq("delivery_date", today).limit(100),
    admin.from("pos_orders").select(SHOP_SELECT).eq("location_id", locationId).in("status", ACTIVE).limit(300),
    admin.from("pos_orders").select(SHOP_SELECT).eq("location_id", locationId).eq("status", "completed").eq("delivery_date", today).limit(100),
  ]);
  for (const r of [active, done, shopActive, shopDone]) if (r.error) throw new Error(`Заказы: ${r.error.message}`);

  const site = ((active.data ?? []) as unknown as Row[]).map(toWorkOrder);
  const shop = ((shopActive.data ?? []) as unknown as ShopRow[]).map(toShopOrder);
  return {
    work: [...site.filter((o) => o.paid), ...shop].sort(byTime),
    awaitingPayment: site.filter((o) => !o.paid).sort(byTime),
    doneToday: [
      ...((done.data ?? []) as unknown as Row[]).map(toWorkOrder),
      ...((shopDone.data ?? []) as unknown as ShopRow[]).map(toShopOrder),
    ].sort(byTime),
  };
}

/** Один заказ магазина — для сборки к нему в кассе. */
export async function getShopOrder(id: string): Promise<WorkOrder | null> {
  const { data, error } = await getSupabaseAdmin().from("pos_orders").select(SHOP_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`Заказ: ${error.message}`);
  return data ? toShopOrder(data as unknown as ShopRow) : null;
}

/**
 * Доставки курьеру. С сайта — только оплаченные: брошенную корзину не
 * везут. Из магазина — все: остаток курьер может взять при получении.
 */
export async function listDeliveries(days: string[], locationId: string): Promise<WorkOrder[]> {
  const admin = getSupabaseAdmin();
  const [site, shop] = await Promise.all([
    admin.from("orders").select(SELECT).eq("is_pickup", false).eq("payment_status", "paid").in("status", ACTIVE).in("delivery_date", days),
    admin.from("pos_orders").select(SHOP_SELECT).eq("location_id", locationId).eq("is_pickup", false).in("status", ACTIVE).in("delivery_date", days),
  ]);
  if (site.error) throw new Error(`Доставки: ${site.error.message}`);
  if (shop.error) throw new Error(`Доставки: ${shop.error.message}`);
  return [
    ...((site.data ?? []) as unknown as Row[]).map(toWorkOrder),
    ...((shop.data ?? []) as unknown as ShopRow[]).map(toShopOrder),
  ].sort(byTime);
}
