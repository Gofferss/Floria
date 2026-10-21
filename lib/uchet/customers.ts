import { getSupabaseAdmin } from "@/lib/supabase";
import { MINUTE, jsonRows, posifloraCached } from "@/lib/posiflora/cached";
import { realLocationIds } from "@/lib/uchet/summary";

// ================================================================
// Клиенты — одна база на сайт и магазин (customers, ключ — телефон в
// виде +7XXXXXXXXXX). Сайт заводит клиента при заказе и входе по SMS,
// касса — когда флорист вбивает телефон покупателя.
//
// Покупки — из трёх мест: заказы сайта (orders.customer_id), чеки кассы
// и заказы магазина. Чеки «Тренировки» не считаются: это пробы.
//
// Personal data: экран только у владельцев, у флориста — поиск в кассе.
// ================================================================

export type CustomerRow = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  bonusBalance: number;
  hasAccount: boolean;
  inPosiflora: boolean;
  createdAt: string;
  purchases: number;
  spent: number;
  lastAt: string | null;
};

export type Purchase = { kind: "site" | "shop" | "shop_order"; number: string; at: string; amount: number; status: string };

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

type Base = {
  id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  bonus_balance: number | string | null;
  auth_user_id: string | null;
  posiflora_client_id: string | null;
  created_at: string;
};

const SELECT = "id, full_name, phone, email, birthday, notes, bonus_balance, auth_user_id, posiflora_client_id, created_at";

async function purchasesOf(ids: string[]): Promise<Map<string, Purchase[]>> {
  const out = new Map<string, Purchase[]>();
  if (!ids.length) return out;
  const admin = getSupabaseAdmin();
  const locations = await realLocationIds();
  const inLocations = locations.length ? locations : ["00000000-0000-0000-0000-000000000000"];
  const [site, sales, shopOrders] = await Promise.all([
    admin.from("orders").select("customer_id, order_number, created_at, paid_at, total_amount, status, payment_status").in("customer_id", ids).limit(5000),
    admin.from("pos_sales").select("customer_id, sale_no, created_at, total, status").in("customer_id", ids).in("location_id", inLocations).limit(5000),
    admin.from("pos_orders").select("customer_id, order_no, created_at, total, status").in("customer_id", ids).in("location_id", inLocations).limit(5000),
  ]);
  for (const r of [site, sales, shopOrders]) if (r.error) throw new Error(`Покупки клиентов: ${r.error.message}`);
  const push = (id: string, p: Purchase) => {
    const list = out.get(id);
    if (list) list.push(p);
    else out.set(id, [p]);
  };
  for (const o of site.data ?? []) {
    // Неоплаченный и отменённый заказ сайта — не покупка.
    if (o.payment_status !== "paid" && o.status !== "completed") continue;
    if (o.status === "cancelled") continue;
    push(o.customer_id, { kind: "site", number: o.order_number, at: o.paid_at ?? o.created_at, amount: num(o.total_amount), status: o.status });
  }
  // Оплата заказа магазина — тоже чек; чтобы не считать дважды, заказ
  // магазина идёт в историю без суммы, сумма — в его чеках.
  for (const s of sales.data ?? []) if (s.status === "paid") push(s.customer_id, { kind: "shop", number: s.sale_no, at: s.created_at, amount: num(s.total), status: s.status });
  for (const o of shopOrders.data ?? []) if (o.status !== "cancelled") push(o.customer_id, { kind: "shop_order", number: o.order_no, at: o.created_at, amount: 0, status: o.status });
  for (const list of out.values()) list.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

function toRow(c: Base, purchases: Purchase[]): CustomerRow {
  const paid = purchases.filter((p) => p.kind !== "shop_order");
  return {
    id: c.id,
    name: c.full_name,
    phone: c.phone,
    email: c.email,
    birthday: c.birthday,
    notes: c.notes,
    bonusBalance: num(c.bonus_balance),
    hasAccount: !!c.auth_user_id,
    inPosiflora: !!c.posiflora_client_id,
    createdAt: c.created_at,
    purchases: paid.length,
    spent: paid.reduce((s, p) => s + p.amount, 0),
    lastAt: purchases[0]?.at ?? null,
  };
}

/** Поиск по цифрам телефона или по имени; без запроса — все (до 500). */
export async function listCustomers(query: string): Promise<CustomerRow[]> {
  const admin = getSupabaseAdmin();
  const q = query.trim();
  const digits = q.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7");
  let req = admin.from("customers").select(SELECT).order("created_at", { ascending: false }).limit(500);
  if (digits.length >= 3) req = req.like("phone", `%${digits.slice(-10)}%`);
  else if (q) req = req.ilike("full_name", `%${q.replace(/[%_]/g, "")}%`);
  const { data, error } = await req;
  if (error) throw new Error(`Клиенты: ${error.message}`);
  const list = (data ?? []) as Base[];
  const purchases = await purchasesOf(list.map((c) => c.id));
  return list
    .map((c) => toRow(c, purchases.get(c.id) ?? []))
    .sort((a, b) => (b.lastAt ?? b.createdAt).localeCompare(a.lastAt ?? a.createdAt));
}

export async function getCustomerHistory(id: string): Promise<Purchase[]> {
  return (await purchasesOf([id])).get(id) ?? [];
}

export type PosifloraCustomer = { id: string; name: string; phone: string | null; points: number; ordersQty: number };

/**
 * Клиенты Posiflora, которых нет в нашей базе (ни по связи, ни по
 * телефону). Их там мало — студия почти не привязывает покупки к людям.
 */
export async function listPosifloraOnlyCustomers(): Promise<PosifloraCustomer[]> {
  const res = await posifloraCached("/customers?page[size]=100", 10 * MINUTE);
  const all = jsonRows(res).map((c) => {
    const local = String(c.attributes?.phone ?? "").replace(/\D/g, "");
    const code = String(c.attributes?.countryCode ?? "7");
    return {
      id: c.id,
      name: String(c.attributes?.title ?? "").trim() || "Без имени",
      phone: local.length === 10 ? `+${code}${local}` : null,
      points: num(c.attributes?.currentPoints),
      ordersQty: num(c.attributes?.ordersQty),
    };
  });
  if (!all.length) return [];
  const { data, error } = await getSupabaseAdmin().from("customers").select("phone, posiflora_client_id");
  if (error) throw new Error(`Клиенты: ${error.message}`);
  const linked = new Set((data ?? []).map((c) => c.posiflora_client_id).filter(Boolean));
  const phones = new Set((data ?? []).map((c) => c.phone));
  return all.filter((c) => !linked.has(c.id) && !(c.phone && phones.has(c.phone)));
}
