"use server";

import { getStaffUser } from "@/lib/auth/server";
import { sendMessage, TelegramApiError } from "@/lib/telegram/bot";
import { listActiveBotUsers, markBotUserBlocked } from "@/lib/telegram/reminders";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type BroadcastSummary = { total: number; sent: number; failed: number };

/**
 * Рассылка всем, кто хоть раз нажал /start у бота-напоминальщика (не
 * только тем, у кого есть активные напоминания) — для кампаний вроде
 * "предзаказы к 8 марта открыты". Небольшая пауза между отправками —
 * подстраховка от лимита Bot API (антиспам на массовые отправки), для
 * реального размера базы малого бизнеса с запасом достаточно.
 */
export async function sendBroadcast(message: string): Promise<ActionResult<BroadcastSummary>> {
  const staff = await getStaffUser();
  if (!staff) return { success: false, error: "Доступ только для сотрудников" };

  const text = message.trim();
  if (!text) return { success: false, error: "Введите текст рассылки" };

  const users = await listActiveBotUsers();
  if (users.length === 0) {
    return { success: false, error: "Пока нет ни одного подписчика бота" };
  }

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      await sendMessage(user.chatId, text);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`[sendBroadcast] chat ${user.chatId}:`, error);
      if (error instanceof TelegramApiError && error.errorCode === 403) {
        await markBotUserBlocked(user.chatId);
      }
    }
    await sleep(50);
  }

  return { success: true, data: { total: users.length, sent, failed } };
}
