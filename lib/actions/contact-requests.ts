"use server";

import { revalidatePath } from "next/cache";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Обращения из формы обратной связи.
//
// Таблица появилась потому, что раньше форма не сохраняла НИЧЕГО:
// сообщение уходило только уведомлением в Telegram, и сбой отправки
// уничтожал вопрос клиента, пока тот читал «спасибо, мы свяжемся».
//
// Отсюда же смысл этого раздела в админке: он нужен не для красоты, а
// как второй способ увидеть обращение — на случай, когда Telegram
// недоступен. Поэтому недоставленные показываются отдельно и первыми.
// ================================================================

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

export type AdminContactRequest = {
  id: string;
  name: string;
  phone: string;
  message: string;
  staffNotifiedAt: string | null;
  handledAt: string | null;
  createdAt: string;
  /** form — заявка с сайта, bot_review — ответ на просьбу об отзыве в боте. */
  source: string;
  orderNumber: string | null;
};

export async function listContactRequests(): Promise<AdminContactRequest[]> {
  await requireStaff();

  const { data, error } = await getSupabaseAdmin()
    .from("contact_requests")
    .select("id, name, phone, message, staff_notified_at, handled_at, created_at, source, orders(order_number)")
    // Необработанные сверху, среди них — свежие первыми.
    .order("handled_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[contact-requests] выборка:", error.message);
    throw new Error("Не удалось загрузить обращения");
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    message: row.message,
    staffNotifiedAt: row.staff_notified_at,
    handledAt: row.handled_at,
    createdAt: row.created_at,
    source: row.source ?? "form",
    // Supabase отдаёт связанную запись объектом или массивом в
    // зависимости от кардинальности связи — приводим к одному виду.
    orderNumber:
      (Array.isArray(row.orders) ? row.orders[0]?.order_number : (row.orders as { order_number?: string } | null)?.order_number) ?? null,
  }));
}

export async function markContactHandled(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  await requireStaff();

  const { error } = await getSupabaseAdmin()
    .from("contact_requests")
    .update({ handled_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[contact-requests] пометка обработанным:", error.message);
    return { success: false, error: "Не удалось отметить обращение" };
  }

  revalidatePath("/admin/contact-requests");
  return { success: true };
}
