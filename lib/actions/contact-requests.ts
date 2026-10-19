"use server";

import { revalidatePath } from "next/cache";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { findChatIdByPhone } from "@/lib/telegram/order-notify";
import { sendMessage, escapeTelegramHtml } from "@/lib/telegram/bot";
import { toE164RussianPhone } from "@/lib/phone-mask";

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
  /**
   * Подключён ли у человека наш бот. Если да — ему можно ответить прямо
   * в Telegram, и для отзывов из бота это единственный уместный способ:
   * человек написал в переписку и ждёт ответа там, а не звонка.
   */
  telegramReachable: boolean;
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

  // Кто из обратившихся подключил бота — одним запросом на весь список,
  // а не по запросу на строку: обращений тут до двухсот.
  const phones = new Map<string, string>();
  (data ?? []).forEach((row) => {
    const e164 = toE164RussianPhone(row.phone as string);
    if (e164) phones.set(row.id as string, e164);
  });

  const reachable = new Set<string>();
  if (phones.size > 0) {
    const { data: users } = await getSupabaseAdmin()
      .from("bot_users")
      .select("phone")
      .in("phone", [...new Set(phones.values())])
      .eq("is_blocked", false);
    (users ?? []).forEach((u) => reachable.add(u.phone as string));
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
    telegramReachable: reachable.has(phones.get(row.id as string) ?? ""),
  }));
}

/**
 * Ответ клиенту прямо в Telegram.
 *
 * Зачем. Отзывы из бота попадают в те же обращения, но человек писал их
 * в переписку — и ждёт ответа там же. Без этого единственным способом
 * ответить был звонок по телефону: на недовольный отзыв звонить уместно
 * не всегда, а на вопрос «а когда привезёте?» — просто долго.
 *
 * Отправленный ответ сразу помечает обращение обработанным: если ответ
 * ушёл, обращение закрыто, и отдельная кнопка после этого — лишний шаг,
 * про который забывают.
 */
export async function replyInTelegram(
  id: string,
  text: string
): Promise<{ success: true } | { success: false; error: string }> {
  await requireStaff();

  const trimmed = text.trim();
  if (!trimmed) return { success: false, error: "Пустой ответ" };
  // Потолок Telegram на одно сообщение — 4096 символов.
  if (trimmed.length > 3500) return { success: false, error: "Слишком длинно — до 3500 символов" };

  const { data: request, error } = await getSupabaseAdmin()
    .from("contact_requests")
    .select("phone, name")
    .eq("id", id)
    .maybeSingle();

  if (error || !request) {
    console.error("[contact-requests] ответ, чтение:", error?.message ?? "нет строки");
    return { success: false, error: "Обращение не найдено" };
  }

  const chatId = await findChatIdByPhone(request.phone as string);
  if (chatId === null) {
    return { success: false, error: "У этого номера нет подключённого бота — позвоните" };
  }

  try {
    await sendMessage(
      chatId,
      `<b>Студия «Флория»</b>\n\n${escapeTelegramHtml(trimmed)}`
    );
  } catch (err) {
    console.error("[contact-requests] ответ, отправка:", err instanceof Error ? err.message : String(err));
    return { success: false, error: "Telegram не принял сообщение. Попробуйте ещё раз." };
  }

  const { error: markError } = await getSupabaseAdmin()
    .from("contact_requests")
    .update({ handled_at: new Date().toISOString() })
    .eq("id", id);

  // Ответ уже ушёл — об этом молчать нельзя, но и ошибкой считать нечего:
  // клиент получил сообщение, просто галочка не встала.
  if (markError) {
    console.error("[contact-requests] ответ ушёл, но отметка не встала:", markError.message);
  }

  revalidatePath("/admin/contact-requests");
  return { success: true };
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
