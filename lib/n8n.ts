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

/**
 * Отправляет сотрудникам и ГОВОРИТ, дошло ли.
 *
 * Раньше функция была fire-and-forget и возвращала void: сбой писался в
 * console.error и на этом заканчивался. Для заказа это значило, что клиент
 * видит «спасибо, скоро свяжемся», а студия не знает о заказе вовсе —
 * узнать об этом можно было, только открыв логи, чего никто не делает.
 *
 * Возвращаемое значение — «дошло хотя бы до одного получателя». Именно
 * хотя бы до одного, а не до всех: если из двух сотрудников сообщение
 * получил один, заказ не потерян, и дёргать тревогу не за чем. А вот ноль
 * получателей — это молчаливая потеря, и вызывающий код обязан её
 * зафиксировать (orders.staff_notified_at / contact_requests.staff_notified_at),
 * чтобы задача добора потом доотправила.
 *
 * Ошибку по-прежнему НЕ пробрасываем: оформление заказа не должно падать
 * из-за недоступности Telegram. Разница в том, что теперь о сбое узнают.
 */
export async function notifyStaffTelegram(text: string): Promise<boolean> {
  const chatIds = staffChatIds();
  if (chatIds.length === 0) {
    console.error(
      "[notifyStaffTelegram] STAFF_TELEGRAM_CHAT_IDS не задан — сообщать некому, уведомление потеряно"
    );
    return false;
  }

  const results = await Promise.all(
    chatIds.map(async (chatId) => {
      try {
        await sendMessage(chatId, text);
        return true;
      } catch (error) {
        console.error(`[notifyStaffTelegram] чат ${chatId}:`, error);
        return false;
      }
    })
  );

  return results.some(Boolean);
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
