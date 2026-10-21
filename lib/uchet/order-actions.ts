"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaffAction } from "@/lib/auth/server";
import { canDeliver } from "@/lib/auth/roles";
import { notifyCustomerAboutStatus } from "@/lib/telegram/order-notify";

// ================================================================
// Отметки курьера: «забрал, везу» и «доставил».
//
// Курьеру не нужна вся смена статусов, что есть у флориста, — только два
// шага, и только вперёд. Поэтому отдельное действие, а не общий
// updateOrderStatus: тот открыт ролям с доступом к заказам сайта, а
// курьеру незачем уметь, например, отменить заказ.
// ================================================================

type Result = { success: true } | { success: false; error: string };

const NEXT: Record<string, "delivering" | "completed" | undefined> = {
  new: "delivering",
  confirmed: "delivering",
  assembling: "delivering",
  ready: "delivering",
  delivering: "completed",
};

export async function courierAdvance(orderId: string, to: "delivering" | "completed", source: "site" | "shop" = "site"): Promise<Result> {
  const staff = await requireStaffAction(canDeliver);
  const admin = getSupabaseAdmin();

  // Заказ магазина: шаги проверяет база, клиенту в бот не пишем (решение
  // владельца — сообщения только по заказам с сайта).
  if (source === "shop") {
    const { error } = await admin.rpc("pos_set_order_status", { p_order: orderId, p_status: to, p_staff: staff.id, p_employee: null });
    if (error) return { success: false, error: error.message || "Не удалось сохранить отметку" };
    revalidatePath("/uchet", "layout");
    return { success: true };
  }

  const { data: order } = await admin.from("orders").select("status, is_pickup, payment_status").eq("id", orderId).maybeSingle();
  if (!order) return { success: false, error: "Заказ не найден" };
  if (order.is_pickup) return { success: false, error: "Это самовывоз — курьер его не везёт" };
  if (NEXT[order.status] !== to) {
    return { success: false, error: order.status === "completed" ? "Заказ уже доставлен" : "Этот шаг сейчас не к месту — обновите список" };
  }

  // Условие на прежний статус — чтобы два нажатия с двух телефонов не
  // записали шаг дважды и не прислали клиенту два одинаковых сообщения.
  const { data: updated, error } = await admin
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", order.status)
    .select("id")
    .maybeSingle();
  if (error) return { success: false, error: "Не удалось сохранить отметку" };
  if (!updated) return { success: false, error: "Кто-то уже отметил этот заказ — обновите список" };

  const { error: historyError } = await admin.from("order_status_history").insert({ order_id: orderId, status: to, changed_by: staff.id });
  if (historyError) console.error("[courierAdvance] history", historyError.message);

  await notifyCustomerAboutStatus(orderId, to);

  revalidatePath("/uchet", "layout");
  revalidatePath("/admin/orders");
  return { success: true };
}
