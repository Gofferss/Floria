import { NextResponse } from "next/server";
import { reportHealth } from "@/lib/health-report";
import { askForReview, findOrdersAwaitingReview, markReviewRequested } from "@/lib/telegram/order-notify";
import crypto from "node:crypto";
import { sendMessage, TelegramApiError } from "@/lib/telegram/bot";
import { findDueReminders, markNotified, markBotUserBlocked } from "@/lib/telegram/reminders";
import { formatDayMonth } from "@/lib/telegram/date-parse";

// Node-рантайм ради crypto.timingSafeEqual и service-role supabase-js.
export const runtime = "nodejs";

/**
 * Дёргается по расписанию извне (Cron-нода в n8n → HTTP Request на этот
 * URL раз в день) — сам Next.js расписание не хранит. Находит
 * напоминания, для которых сегодня ровно remind_days_before дней до
 * события, и рассылает их владельцам. Защищено отдельным секретом
 * (REMINDERS_CRON_SECRET), а не TELEGRAM_WEBHOOK_SECRET — это разные
 * вызывающие стороны (Telegram vs n8n) с разным форматом заголовка.
 */
function isValidSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Просьбы об отзыве едут тем же расписанием, что и напоминания: обе задачи
 * «раз в сутки пробежаться и написать кому надо», отдельный планировщик
 * заводить незачем.
 */
async function sendReviewRequests(): Promise<{ asked: number }> {
  const orders = await findOrdersAwaitingReview();
  let asked = 0;

  for (const orderId of orders) {
    const ok = await askForReview(orderId);
    // Помечаем в любом случае: если бота у клиента нет, он не появится
    // задним числом, и перебирать этот заказ каждый прогон бессмысленно.
    await markReviewRequested(orderId);
    if (ok) asked += 1;
  }

  return { asked };
}

export async function POST(request: Request) {
  const expectedSecret = process.env.REMINDERS_CRON_SECRET;
  if (!expectedSecret) {
    console.error("REMINDERS_CRON_SECRET не задан в переменных окружения");
    return NextResponse.json({ error: "Рассылка напоминаний не настроена" }, { status: 500 });
  }

  const receivedSecret = request.headers.get("x-cron-secret");
  if (!isValidSecret(receivedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await findDueReminders();

  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    try {
      await sendMessage(
        reminder.chatId,
        `🌸 Напоминание: через ${reminder.remindDaysBefore} дней — «${reminder.title}» ` +
          `(${formatDayMonth(reminder.eventDay, reminder.eventMonth)}).\n\n` +
          "Самое время оформить букет заранее, чтобы точно успеть 🌷"
      );
      await markNotified(reminder.id, reminder.occurrence.getUTCFullYear());
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`[send-due-reminders] chat ${reminder.chatId}:`, error);
      // 403 — бот заблокирован пользователем: перестаём слать ему вообще
      // (и рассылки из /admin/broadcast тоже это учитывают).
      if (error instanceof TelegramApiError && error.errorCode === 403) {
        await markBotUserBlocked(reminder.chatId);
      }
    }
  }

  const reviews = await sendReviewRequests();

  // Задача суточная, поэтому порог 1: ждать три дня, прежде чем сказать,
  // что напоминания не уходят, — значит потерять три дня поводов.
  await reportHealth({
    key: "daily-reminders",
    title: "Напоминания о датах и просьбы об отзыве",
    ok: failed === 0,
    errorText: `не удалось отправить напоминаний: ${failed}`,
    failThreshold: 1,
  });

  return NextResponse.json({ checked: due.length, sent, failed, reviewsAsked: reviews.asked });
}
