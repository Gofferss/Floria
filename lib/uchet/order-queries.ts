import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Заказы для учёта: что собрать и отвезти — по дням.
//
// В работу попадают оплаченные заказы. Неоплаченный заказ с сайта — это
// чаще всего брошенная корзина (оплата онлайн обязательна), поэтому такие
// идут отдельным свёрнутым списком: флорист видит, что они есть, но не
// собирает букет под оплату, которой может не случиться.
// ================================================================

export type WorkOrderStatus = "new" | "confirmed" | "assembling" | "ready" | "delivering" | "completed" | "cancelled";

export type WorkOrder = {
  id: string;
  number: string;
  status: WorkOrderStatus;
  paid: boolean;
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
  return {
    id: r.id,
    number: r.order_number,
    status: r.status,
    paid: r.payment_status === "paid",
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
    total: Number(r.total_amount) || 0,
    floristAcceptedAt: r.florist_accepted_at,
    photos: r.assembled_photos ?? [],
    photosSentAt: r.assembled_photo_sent_at,
    items: (r.order_items ?? []).map((i) => ({ name: i.product_name, qty: i.quantity })),
  };
}

/**
 * Заказы в работе: все незавершённые, плюс завершённые сегодня — чтобы
 * было видно, что уже отвезли. Отменённые и старые завершённые — в
 * админке сайта.
 */
export async function listWorkOrders(): Promise<{ work: WorkOrder[]; awaitingPayment: WorkOrder[]; doneToday: WorkOrder[] }> {
  const admin = getSupabaseAdmin();
  const today = studioDate(0);
  const [active, done] = await Promise.all([
    admin.from("orders").select(SELECT).in("status", ACTIVE).order("delivery_date").order("delivery_time_from", { nullsFirst: true }).limit(300),
    admin.from("orders").select(SELECT).eq("status", "completed").eq("delivery_date", today).limit(100),
  ]);
  if (active.error) throw new Error(`Заказы: ${active.error.message}`);
  if (done.error) throw new Error(`Заказы: ${done.error.message}`);

  const list = ((active.data ?? []) as unknown as Row[]).map(toWorkOrder);
  return {
    work: list.filter((o) => o.paid),
    awaitingPayment: list.filter((o) => !o.paid),
    doneToday: ((done.data ?? []) as unknown as Row[]).map(toWorkOrder),
  };
}

/** Доставки курьеру: только оплаченные и только с доставкой — брошенную корзину не везут. */
export async function listDeliveries(days: string[]): Promise<WorkOrder[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select(SELECT)
    .eq("is_pickup", false)
    .eq("payment_status", "paid")
    .in("status", ACTIVE)
    .in("delivery_date", days)
    .order("delivery_date")
    .order("delivery_time_from", { nullsFirst: true });
  if (error) throw new Error(`Доставки: ${error.message}`);
  return ((data ?? []) as unknown as Row[]).map(toWorkOrder);
}
