"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaffAction } from "@/lib/auth/server";
import { canUseUchetWork } from "@/lib/auth/roles";
import { actorFor } from "@/lib/uchet/employee";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { getOpenShift } from "@/lib/uchet/pos-queries";
import { geocode, suggestAddresses, type AddressSuggestion } from "@/lib/geo/dadata";
import { withCity } from "@/lib/uchet/delivery-plan";

// ================================================================
// Заказы магазина на дату (pos_orders, миграция 029).
//
// Клиенту в бот по ним не пишем — так решил владелец: заказы из зала и по
// телефону не должны грузить систему сообщениями, как заказы с сайта.
// Оплата заказа — обычная продажа со строкой «оплата заказа»
// (recordSale в pos-actions), поэтому она попадает в смену и кассу.
// ================================================================

type Result<T = undefined> = { success: true; data: T } | { success: false; error: string };

function dbMessage(error: { message?: string } | null | undefined, fallback: string): string {
  const message = error?.message?.trim();
  return message ? message : fallback;
}

async function who() {
  return actorFor(await requireStaffAction(canUseUchetWork));
}

function refresh() {
  revalidatePath("/uchet", "layout");
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/**
 * Точка на карте для адреса заказа — сразу при сохранении, чтобы план
 * доставок не ждал. Не нашлась — не страшно: план попробует ещё раз.
 */
async function placeOnMap(orderId: string, f: ShopOrderFields) {
  if (f.isPickup || !f.deliveryAddress.trim()) return;
  const p = await geocode(withCity(f.deliveryAddress, null));
  if (!p) return;
  await getSupabaseAdmin().from("pos_orders").update({ delivery_lat: p.lat, delivery_lon: p.lon, geo_quality: p.quality }).eq("id", orderId);
}

/** Подсказки адреса при вводе (DaData). Без ключа — пустой список. */
export async function suggestAddress(query: string): Promise<AddressSuggestion[]> {
  await requireStaffAction(canUseUchetWork);
  return suggestAddresses(query);
}

export type ShopOrderFields = {
  channel: "shop" | "phone" | "messenger" | "other";
  customerName: string;
  customerPhone: string;
  recipientName: string;
  recipientPhone: string;
  isPickup: boolean;
  deliveryAddress: string;
  deliveryDetails: string;
  deliveryDate: string;
  timeFrom: string;
  timeTo: string;
  cardText: string;
  wishes: string;
  courierComment: string;
  total: number;
};

function toDb(f: ShopOrderFields) {
  return {
    channel: f.channel,
    customer_name: f.customerName,
    customer_phone: f.customerPhone,
    recipient_name: f.recipientName,
    recipient_phone: f.recipientPhone,
    is_pickup: f.isPickup,
    delivery_address: f.isPickup ? "" : f.deliveryAddress,
    delivery_details: f.isPickup ? "" : f.deliveryDetails,
    delivery_date: f.deliveryDate,
    time_from: f.timeFrom,
    time_to: f.timeTo,
    card_text: f.cardText,
    wishes: f.wishes,
    courier_comment: f.courierComment,
    total: f.total,
  };
}

function checkFields(f: ShopOrderFields): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.deliveryDate)) return "Укажите дату";
  if (!Number.isFinite(f.total) || f.total < 0) return "Укажите сумму заказа";
  if (f.timeFrom && !/^\d{2}:\d{2}$/.test(f.timeFrom)) return "Время «с» — в виде 15:00";
  if (f.timeTo && !/^\d{2}:\d{2}$/.test(f.timeTo)) return "Время «до» — в виде 17:00";
  return null;
}

export type CreateShopOrderInput = {
  id: string;
  fields: ShopOrderFields;
  /** Предоплата: сколько и как. Пусто — без предоплаты. */
  prepay: { saleId: string; payments: { method: string; amount: number }[] } | null;
};

export async function createShopOrder(input: CreateShopOrderInput): Promise<Result<{ orderNo: string; saleNo: string | null }>> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  if (!isUuid(input.id)) return { success: false, error: "Нет идентификатора заказа" };
  const bad = checkFields(input.fields);
  if (bad) return { success: false, error: bad };

  const location = await getDefaultLocation();
  let prepay: Record<string, unknown> | null = null;
  const prepayAmount = input.prepay?.payments.reduce((s, p) => s + (p.amount > 0 ? p.amount : 0), 0) ?? 0;
  if (input.prepay && prepayAmount > 0) {
    if (prepayAmount > input.fields.total) return { success: false, error: "Предоплата больше суммы заказа" };
    const shift = await getOpenShift(location.id);
    if (!shift) return { success: false, error: "Чтобы принять предоплату, откройте смену. Или оформите заказ без предоплаты" };
    prepay = {
      sale_id: input.prepay.saleId,
      shift_id: shift.id,
      payments: input.prepay.payments.filter((p) => p.amount > 0).map((p) => ({ method: p.method, amount: p.amount })),
    };
  }

  const { data, error } = await getSupabaseAdmin().rpc("pos_create_order", {
    p_order: { id: input.id, ...toDb(input.fields) },
    p_prepay: prepay,
    p_location: location.id,
    p_staff: w.actor.staff.id,
    p_employee: w.actor.employee?.id ?? null,
  });
  if (error || !data) return { success: false, error: dbMessage(error, "Не удалось оформить заказ") };
  await placeOnMap(input.id, input.fields);
  refresh();
  const r = data as { order_no: string; sale_no: string | null };
  return { success: true, data: { orderNo: r.order_no, saleNo: r.sale_no ?? null } };
}

export async function updateShopOrder(id: string, fields: ShopOrderFields): Promise<Result> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  const bad = checkFields(fields);
  if (bad) return { success: false, error: bad };
  const { error } = await getSupabaseAdmin().rpc("pos_update_order", { p_order: id, p_patch: toDb(fields) });
  if (error) return { success: false, error: dbMessage(error, "Не удалось сохранить заказ") };
  await placeOnMap(id, fields);
  refresh();
  return { success: true, data: undefined };
}

export async function setShopOrderStatus(id: string, status: "assembling" | "ready" | "delivering" | "completed"): Promise<Result> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  const { error } = await getSupabaseAdmin().rpc("pos_set_order_status", {
    p_order: id,
    p_status: status,
    p_staff: w.actor.staff.id,
    p_employee: w.actor.employee?.id ?? null,
  });
  if (error) return { success: false, error: dbMessage(error, "Не удалось сменить шаг заказа") };
  refresh();
  return { success: true, data: undefined };
}

export async function cancelShopOrder(id: string, refund: "cash" | "other" | "keep" | null, reason: string): Promise<Result<{ refunded: number; toVitrine: number }>> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  const { data, error } = await getSupabaseAdmin().rpc("pos_cancel_order", {
    p_order: id,
    p_refund: refund,
    p_reason: reason.trim() || null,
    p_staff: w.actor.staff.id,
    p_employee: w.actor.employee?.id ?? null,
  });
  if (error || !data) return { success: false, error: dbMessage(error, "Не удалось отменить заказ") };
  refresh();
  const r = data as { refunded: number; to_vitrine: number };
  return { success: true, data: { refunded: Number(r.refunded) || 0, toVitrine: Number(r.to_vitrine) || 0 } };
}
