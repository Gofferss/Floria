import { getSupabaseAdmin } from "@/lib/supabase";
import { isVtbSandbox } from "@/lib/payments/vtb";
import { CONTACTS } from "@/lib/contacts";
import { geocode, hasDadataKey } from "@/lib/geo/dadata";
import type { Point } from "@/lib/uchet/route";

// ================================================================
// План доставок на день: что везти, где это на карте, кто везёт и в каком
// порядке. Заказы сайта и магазина — вместе: курьеру всё равно, откуда
// пришёл заказ.
//
// Адреса переводятся в точки при первом открытии плана и запоминаются в
// самом заказе (delivery_lat/lon), так что повторно DaData не спрашиваем.
// ================================================================

export type PlanStop = {
  /** Ключ «site:uuid» или «shop:uuid» — у двух источников свои id. */
  key: string;
  source: "site" | "shop";
  id: string;
  number: string;
  status: string;
  date: string;
  timeFrom: string | null;
  timeTo: string | null;
  address: string | null;
  addressExtra: string | null;
  point: Point | null;
  /** Точность точки: 0–1 дом, 2 улица, 3–4 только город. */
  quality: number | null;
  courierId: string | null;
  seq: number | null;
  recipientName: string;
  recipientPhone: string;
  courierComment: string | null;
  cardText: string | null;
  /** Сколько взять при получении (у заказов магазина). */
  due: number;
  /** Заказ сайта оплачен в песочнице ВТБ — денег нет. */
  testPayment: boolean;
};

export type Courier = { id: string; name: string };

/** Студия — откуда выезжает курьер. Нет ключа DaData — центр города. */
const STUDIO_FALLBACK: Point = { lat: 44.9521, lon: 34.1024 };

export async function studioPoint(): Promise<Point> {
  const p = await geocode(CONTACTS.addressFull);
  return p ? { lat: p.lat, lon: p.lon } : STUDIO_FALLBACK;
}

export async function listCouriers(): Promise<Courier[]> {
  const { data, error } = await getSupabaseAdmin().from("staff").select("id, full_name").eq("role", "courier").eq("is_active", true).order("full_name");
  if (error) throw new Error(`Курьеры: ${error.message}`);
  return (data ?? []).map((s) => ({ id: s.id, name: s.full_name }));
}

const SITE_SELECT =
  "id, order_number, status, payment_status, delivery_date, delivery_time_from, delivery_time_to, delivery_city, delivery_address, " +
  "delivery_apartment, delivery_entrance, delivery_floor, delivery_intercom_code, recipient_name, recipient_phone, courier_comment, card_text, " +
  "delivery_lat, delivery_lon, geo_quality, courier_staff_id, route_seq, total_amount";

const SHOP_SELECT =
  "id, order_no, status, delivery_date, time_from, time_to, delivery_address, delivery_details, recipient_name, recipient_phone, customer_name, " +
  "customer_phone, courier_comment, card_text, delivery_lat, delivery_lon, geo_quality, courier_staff_id, route_seq, total, " +
  "pos_sale_lines(amount, pos_sales(status))";

type SiteRow = {
  id: string;
  order_number: string;
  status: string;
  delivery_date: string;
  delivery_time_from: string | null;
  delivery_time_to: string | null;
  delivery_city: string | null;
  delivery_address: string | null;
  delivery_apartment: string | null;
  delivery_entrance: string | null;
  delivery_floor: string | null;
  delivery_intercom_code: string | null;
  recipient_name: string;
  recipient_phone: string;
  courier_comment: string | null;
  card_text: string | null;
  delivery_lat: number | string | null;
  delivery_lon: number | string | null;
  geo_quality: number | null;
  courier_staff_id: string | null;
  route_seq: number | null;
};

type ShopRow = {
  id: string;
  order_no: string;
  status: string;
  delivery_date: string;
  time_from: string | null;
  time_to: string | null;
  delivery_address: string | null;
  delivery_details: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  courier_comment: string | null;
  card_text: string | null;
  delivery_lat: number | string | null;
  delivery_lon: number | string | null;
  geo_quality: number | null;
  courier_staff_id: string | null;
  route_seq: number | null;
  total: number | string;
  pos_sale_lines: { amount: number | string; pos_sales: { status: string } | { status: string }[] | null }[] | null;
};

const point = (lat: unknown, lon: unknown): Point | null =>
  lat === null || lon === null || lat === undefined || lon === undefined ? null : { lat: Number(lat), lon: Number(lon) };

/** Город к адресу, если его в адресе нет: «Гоголя, 7» → «Симферополь, Гоголя, 7». */
export function withCity(address: string, city: string | null): string {
  if (/симферопол|\bг\.?\s|пгт|\bс\.\s|посел|район|село/i.test(address)) return address;
  return `${city || CONTACTS.city}, ${address}`;
}

/**
 * Доставки дня — оплаченные с сайта и все из магазина, кроме отменённых.
 * Доставленные тоже: курьер видит, что уже отвёз, а план не теряет
 * номера остановок.
 */
export async function loadDayStops(day: string, locationId: string): Promise<PlanStop[]> {
  const admin = getSupabaseAdmin();
  const [site, shop] = await Promise.all([
    admin.from("orders").select(SITE_SELECT).eq("is_pickup", false).eq("payment_status", "paid").eq("delivery_date", day).neq("status", "cancelled"),
    admin.from("pos_orders").select(SHOP_SELECT).eq("location_id", locationId).eq("is_pickup", false).eq("delivery_date", day).neq("status", "cancelled"),
  ]);
  if (site.error) throw new Error(`Доставки сайта: ${site.error.message}`);
  if (shop.error) throw new Error(`Доставки магазина: ${shop.error.message}`);

  const stops: PlanStop[] = [];
  for (const r of (site.data ?? []) as unknown as SiteRow[]) {
    const extra = [
      r.delivery_apartment && `кв. ${r.delivery_apartment}`,
      r.delivery_entrance && `подъезд ${r.delivery_entrance}`,
      r.delivery_floor && `этаж ${r.delivery_floor}`,
      r.delivery_intercom_code && `домофон ${r.delivery_intercom_code}`,
    ]
      .filter(Boolean)
      .join(", ");
    stops.push({
      key: `site:${r.id}`,
      source: "site",
      id: r.id,
      number: r.order_number,
      status: r.status,
      date: r.delivery_date,
      timeFrom: r.delivery_time_from?.slice(0, 5) ?? null,
      timeTo: r.delivery_time_to?.slice(0, 5) ?? null,
      address: r.delivery_address ? withCity(r.delivery_address, r.delivery_city) : null,
      addressExtra: extra || null,
      point: point(r.delivery_lat, r.delivery_lon),
      quality: r.geo_quality,
      courierId: r.courier_staff_id,
      seq: r.route_seq,
      recipientName: r.recipient_name,
      recipientPhone: r.recipient_phone,
      courierComment: r.courier_comment,
      cardText: r.card_text,
      due: 0,
      testPayment: isVtbSandbox(),
    });
  }
  for (const r of (shop.data ?? []) as unknown as ShopRow[]) {
    const paid = (r.pos_sale_lines ?? [])
      .filter((l) => (Array.isArray(l.pos_sales) ? l.pos_sales[0] : l.pos_sales)?.status === "paid")
      .reduce((s, l) => s + (Number(l.amount) || 0), 0);
    stops.push({
      key: `shop:${r.id}`,
      source: "shop",
      id: r.id,
      number: r.order_no,
      status: r.status,
      date: r.delivery_date,
      timeFrom: r.time_from?.slice(0, 5) ?? null,
      timeTo: r.time_to?.slice(0, 5) ?? null,
      address: r.delivery_address ? withCity(r.delivery_address, null) : null,
      addressExtra: r.delivery_details,
      point: point(r.delivery_lat, r.delivery_lon),
      quality: r.geo_quality,
      courierId: r.courier_staff_id,
      seq: r.route_seq,
      recipientName: r.recipient_name ?? r.customer_name ?? "—",
      recipientPhone: r.recipient_phone ?? r.customer_phone ?? "",
      courierComment: r.courier_comment,
      cardText: r.card_text,
      due: Math.max(0, (Number(r.total) || 0) - paid),
      testPayment: false,
    });
  }
  return stops;
}

/**
 * Точки для адресов, у которых их ещё нет. Найденное сразу пишем в заказ.
 * По одному запросу за раз: доставок на день десятки, а DaData отвечает
 * быстро — параллелить незачем, а при сбое проще остановиться.
 */
export async function ensurePoints(stops: PlanStop[]): Promise<{ found: number; missing: number; noKey: boolean }> {
  if (!hasDadataKey()) return { found: 0, missing: stops.filter((s) => !s.point).length, noKey: true };
  const admin = getSupabaseAdmin();
  let found = 0;
  for (const s of stops) {
    if (s.point || !s.address) continue;
    const p = await geocode(s.address);
    if (!p) continue;
    s.point = { lat: p.lat, lon: p.lon };
    s.quality = p.quality;
    found++;
    await admin
      .from(s.source === "site" ? "orders" : "pos_orders")
      .update({ delivery_lat: p.lat, delivery_lon: p.lon, geo_quality: p.quality })
      .eq("id", s.id);
  }
  return { found, missing: stops.filter((s) => !s.point).length, noKey: false };
}

/** Записать курьера и номер остановки. */
export async function saveStopPlan(stop: Pick<PlanStop, "source" | "id">, courierId: string | null, seq: number | null): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from(stop.source === "site" ? "orders" : "pos_orders")
    .update({ courier_staff_id: courierId, route_seq: seq })
    .eq("id", stop.id);
  if (error) throw new Error(`План доставки ${stop.id}: ${error.message}`);
}
