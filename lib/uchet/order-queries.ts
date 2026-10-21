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
  /** Когда закрыт: доставлен, выдан или отменён. */
  closedAt: string | null;
  /** Почему отменён — у заказов магазина. */
  cancelReason: string | null;
};

const ACTIVE: WorkOrderStatus[] = ["new", "confirmed", "assembling", "ready", "delivering"];

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" });

/** Начало дня по Симферополю (UTC+3 круглый год) — для выборок «за день». */
export function dayStart(day: string): string {
  return `${day}T00:00:00+03:00`;
}

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
  updated_at: string;
  order_items: { product_name: string; quantity: number }[] | null;
};

const SELECT =
  "id, order_number, status, payment_status, is_pickup, delivery_date, delivery_time_from, delivery_time_to, delivery_address, " +
  "delivery_apartment, delivery_entrance, delivery_floor, delivery_intercom_code, recipient_name, recipient_phone, customer_name, " +
  "customer_phone, is_recipient_self, card_text, courier_comment, admin_comment, total_amount, florist_accepted_at, assembled_photos, " +
  "assembled_photo_sent_at, updated_at, order_items(product_name, quantity)";

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
    // У заказа сайта отдельной отметки нет — берём последнее изменение.
    closedAt: r.status === "completed" || r.status === "cancelled" ? r.updated_at : null,
    cancelReason: null,
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
  closed_at: string | null;
  cancel_reason: string | null;
  pos_bouquets: { title: string; photo_urls: string[] | null; status: string }[] | null;
  pos_sale_lines: { amount: number | string; pos_sales: { status: string } | { status: string }[] | null }[] | null;
};

const SHOP_SELECT =
  "id, order_no, status, channel, customer_name, customer_phone, recipient_name, recipient_phone, is_pickup, delivery_address, " +
  "delivery_details, delivery_date, time_from, time_to, card_text, wishes, courier_comment, total, closed_at, cancel_reason, " +
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
    closedAt: r.closed_at,
    cancelReason: r.cancel_reason,
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
    admin.from("orders").select(SELECT).eq("status", "completed").gte("updated_at", dayStart(today)).limit(100),
    admin.from("pos_orders").select(SHOP_SELECT).eq("location_id", locationId).in("status", ACTIVE).limit(300),
    admin.from("pos_orders").select(SHOP_SELECT).eq("location_id", locationId).eq("status", "completed").gte("closed_at", dayStart(today)).limit(100),
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

// ---------------------------------------------------------------
// Выполненные и отменённые
// ---------------------------------------------------------------

/**
 * Закрытые заказы за последние дни: доставлены, выданы, отменены — с
 * сайта и из магазина. Отсюда же видно долги: заказ магазина отдали, а
 * оплатили не всё.
 */
export async function listClosedOrders(locationId: string, days = 14): Promise<WorkOrder[]> {
  const admin = getSupabaseAdmin();
  const since = dayStart(studioDate(-days));
  const [site, shop] = await Promise.all([
    admin.from("orders").select(SELECT).in("status", ["completed", "cancelled"]).gte("updated_at", since).limit(500),
    admin.from("pos_orders").select(SHOP_SELECT).eq("location_id", locationId).in("status", ["completed", "cancelled"]).gte("closed_at", since).limit(500),
  ]);
  if (site.error) throw new Error(`Выполненные заказы: ${site.error.message}`);
  if (shop.error) throw new Error(`Выполненные заказы: ${shop.error.message}`);
  return [
    ...((site.data ?? []) as unknown as Row[]).map(toWorkOrder),
    ...((shop.data ?? []) as unknown as ShopRow[]).map(toShopOrder),
  ].sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
}

// ---------------------------------------------------------------
// Продажи в зале
// ---------------------------------------------------------------

export type HallSale = {
  id: string;
  saleNo: string;
  at: string;
  status: "paid" | "returned";
  total: number;
  discountPercent: number;
  who: string | null;
  lines: { kind: string; title: string; qty: number; amount: number; orderNo: string | null }[];
  payments: { title: string; amount: number }[];
};

/** Все чеки дня в этом месте — продажи в зале и оплаты заказов. */
export async function listHallSales(locationId: string, day: string): Promise<HallSale[]> {
  const next = new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await getSupabaseAdmin()
    .from("pos_sales")
    .select(
      "id, sale_no, created_at, status, total, discount_percent, hr_employees!pos_sales_employee_id_fkey(short_name), " +
        "pos_sale_lines(kind, title, qty, amount, sort, pos_orders(order_no)), pos_payments(amount, pos_payment_methods(title))"
    )
    .eq("location_id", locationId)
    .gte("created_at", dayStart(day))
    .lt("created_at", dayStart(next))
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Продажи за день: ${error.message}`);

  type One<T> = T | T[] | null;
  const first = <T,>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);
  type SaleRow = {
    id: string;
    sale_no: string;
    created_at: string;
    status: "paid" | "returned";
    total: number | string;
    discount_percent: number | string;
    hr_employees: One<{ short_name: string }>;
    pos_sale_lines: { kind: string; title: string; qty: number | string; amount: number | string; sort: number; pos_orders: One<{ order_no: string }> }[];
    pos_payments: { amount: number | string; pos_payment_methods: One<{ title: string }> }[];
  };

  return ((data ?? []) as unknown as SaleRow[]).map((r) => ({
    id: r.id,
    saleNo: r.sale_no,
    at: r.created_at,
    status: r.status,
    total: Number(r.total) || 0,
    discountPercent: Number(r.discount_percent) || 0,
    who: first(r.hr_employees)?.short_name ?? null,
    lines: [...r.pos_sale_lines]
      .sort((a, b) => a.sort - b.sort)
      .map((l) => ({ kind: l.kind, title: l.title, qty: Number(l.qty) || 1, amount: Number(l.amount) || 0, orderNo: first(l.pos_orders)?.order_no ?? null })),
    payments: r.pos_payments.map((p) => ({ title: first(p.pos_payment_methods)?.title ?? "—", amount: Number(p.amount) || 0 })),
  }));
}
