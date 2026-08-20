"use server";

import { revalidatePath } from "next/cache";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Управление статусом заказа из /admin/orders. Заказы с сайта пока не
// попадают в Posiflora по-настоящему (см. lib/posiflora/orders.ts —
// заглушка), а их публичный API вообще не даёт привязать состав к
// заказу — статус пришлось бы отслеживать там вручную и негде. Поэтому
// статус — целиком наш: сотрудник меняет его здесь, клиент видит
// изменение в /account (components/account/OrderHistoryList.tsx читает
// orders.status напрямую, без дополнительных правок).
// ================================================================

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

export type OrderStatus =
  | "new"
  | "confirmed"
  | "assembling"
  | "ready"
  | "delivering"
  | "completed"
  | "cancelled";

type ActionResult = { success: true } | { success: false; error: string };

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<ActionResult> {
  const staff = await requireStaff();

  const { error } = await getSupabaseAdmin().from("orders").update({ status }).eq("id", orderId);
  if (error) {
    console.error("[updateOrderStatus]", error.message);
    return { success: false, error: "Не удалось обновить статус" };
  }

  const { error: historyError } = await getSupabaseAdmin()
    .from("order_status_history")
    .insert({ order_id: orderId, status, changed_by: staff.id });
  if (historyError) console.error("[updateOrderStatus] history", historyError.message);

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { success: true };
}

/**
 * Отдельная от статуса отметка «флорист увидел и взял в работу» — быстрый
 * чек-бокс в списке заказов, не требует открывать карточку и выбирать
 * стадию. accepted=false очищает отметку (снять галочку по ошибке).
 */
export async function setOrderFloristAccepted(orderId: string, accepted: boolean): Promise<ActionResult> {
  await requireStaff();

  const { error } = await getSupabaseAdmin()
    .from("orders")
    .update({ florist_accepted_at: accepted ? new Date().toISOString() : null })
    .eq("id", orderId);

  if (error) {
    console.error("[setOrderFloristAccepted]", error.message);
    return { success: false, error: "Не удалось сохранить отметку" };
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { success: true };
}
