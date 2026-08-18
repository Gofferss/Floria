// ================================================================
// Единая точка выхода в n8n — оттуда уже разлетается в Telegram
// (сотрудникам, не клиентам — филиация по чату/боту настраивается в
// самом workflow n8n, не здесь) и на почту. И заказы, и заявки на
// обратный звонок идут через один и тот же вебхук с разным полем
// event — в n8n это один Webhook-триггер + Switch-нода по event.
// ================================================================

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
