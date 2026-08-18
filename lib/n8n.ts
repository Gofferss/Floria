// ================================================================
// Уведомления о заказах/заявках сотрудникам.
//
// Telegram шлётся ПРЯМО с сайта (notifyStaffTelegram), не через n8n —
// на практике исходящие соединения от контейнера n8n до api.telegram.org
// на этом сервере оказались нестабильными (~1 из 3 попыток теряется даже
// с повторами), а сам сайт всё это время слал сообщения боту-напоминальщику
// без единого сбоя. notifyN8n остаётся для остального (в первую очередь —
// почта, когда появятся SMTP-данные) и на будущее, если Telegram-часть
// когда-нибудь перенесут обратно в n8n.
// ================================================================

import { sendMessage } from "@/lib/telegram/bot";

function staffChatIds(): number[] {
  const raw = process.env.STAFF_TELEGRAM_CHAT_IDS ?? "";
  return raw
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id));
}

/** Fire-and-forget, как и notifyN8n — сбой уведомления не должен ломать оформление заказа/заявки. */
export function notifyStaffTelegram(text: string): void {
  const chatIds = staffChatIds();
  if (chatIds.length === 0) {
    console.warn("STAFF_TELEGRAM_CHAT_IDS не задан — уведомление сотрудникам в Telegram пропущено");
    return;
  }

  for (const chatId of chatIds) {
    sendMessage(chatId, text).catch((error) => {
      console.error(`Не удалось отправить уведомление в Telegram (chat ${chatId}):`, error);
    });
  }
}

export type N8nEvent =
  | {
      event: "order.created";
      orderNumber: string;
      customerName: string;
      customerPhone: string;
      recipientName: string;
      deliveryDate: string;
      deliveryTimeLabel: string;
      address: string;
      totalAmount: number;
      itemsCount: number;
    }
  | {
      event: "contact.created";
      name: string;
      phone: string;
      message: string;
    };

/**
 * Fire-and-forget — задержка/недоступность n8n не должна задерживать ответ
 * клиенту. Без await у fetch намеренно.
 *
 * Важно для serverless-хостингов (например, Vercel): там процесс может
 * завершиться сразу после return и оборвать фоновый fetch — там
 * потребовался бы ctx.waitUntil(...). При деплое на постоянно работающий
 * Node-процесс (Coolify на Timeweb Cloud, как в этом проекте) фоновый
 * fetch отработает штатно и без этого.
 */
export function notifyN8n(event: N8nEvent): void {
  const url = process.env.N8N_ORDER_WEBHOOK_URL;
  if (!url) {
    console.warn("N8N_ORDER_WEBHOOK_URL не задан — уведомление в Telegram/почту пропущено");
    return;
  }

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch((error) => {
    console.error("Не удалось отправить вебхук в n8n:", error);
  });
}
