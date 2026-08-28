import { getSupabaseAdmin } from "@/lib/supabase";
import { sendMessage, sendPhoto, escapeTelegramHtml } from "@/lib/telegram/bot";
import { toE164RussianPhone } from "@/lib/phone-mask";
import { CONTACTS } from "@/lib/contacts";
import { setSession } from "@/lib/telegram/reminders";
import { notifyStaffTelegram } from "@/lib/n8n";

// ================================================================
// Сообщения КЛИЕНТУ о его заказе.
//
// Не путать с уведомлениями персоналу (те уходят на фиксированные чаты
// из STAFF_TELEGRAM_CHAT_IDS при оформлении заказа). Здесь наоборот:
// пишем человеку, который заказ сделал.
//
// Путь до чата: заказ -> телефон -> bot_users. Телефон берём из самого
// заказа, а не из карточки клиента: гостевой заказ карточки может и не
// иметь, а номер в заказе есть всегда.
//
// Молчим, если чат не найден. Клиент просто не подключал бота — это
// обычное дело, а не ошибка: он узнает статус на сайте.
// ================================================================

/** Кому пишем: chat_id привязанного бота или null. */
async function findChatIdForOrder(orderId: string): Promise<{ chatId: number; orderNumber: string } | null> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("order_number, customer_phone")
    .eq("id", orderId)
    .maybeSingle();

  if (!order?.customer_phone) return null;

  const phone = toE164RussianPhone(order.customer_phone);
  if (!phone) return null;

  const { data } = await supabaseAdmin
    .from("bot_users")
    .select("chat_id")
    .eq("phone", phone)
    .eq("is_blocked", false)
    .limit(1);

  const chatId = data?.[0]?.chat_id;
  if (typeof chatId !== "number") return null;

  return { chatId, orderNumber: order.order_number as string };
}

/**
 * Тексты статусов.
 *
 * Пишем не про все: «новый» клиент только что видел на экране сам, а
 * «готов» и «отменён» требуют разговора, а не автоматического сообщения.
 * Сообщение без пользы приучает не читать бота вовсе.
 */
const STATUS_MESSAGES: Record<string, (n: string) => string> = {
  confirmed: (n) =>
    `✅ Заказ <b>${n}</b> подтверждён.\n\nМы всё проверили и взяли его в работу. Напишем, когда флорист начнёт собирать букет.`,
  assembling: (n) =>
    `💐 Собираем ваш букет по заказу <b>${n}</b>.\n\nКак только будет готов — пришлём фотографию, чтобы вы увидели его до доставки.`,
  delivering: (n) =>
    `🚗 Заказ <b>${n}</b> уже в пути.\n\nКурьер свяжется с получателем перед вручением.`,
  completed: (n) =>
    `🎉 Заказ <b>${n}</b> доставлен.\n\nСпасибо, что выбрали нас. Хорошего дня!`,
};

export async function notifyCustomerAboutStatus(orderId: string, status: string): Promise<void> {
  const build = STATUS_MESSAGES[status];
  if (!build) return;

  try {
    const target = await findChatIdForOrder(orderId);
    if (!target) return;
    await sendMessage(target.chatId, build(target.orderNumber));
  } catch (error) {
    // Уведомление вторично: заказ и его статус уже сохранены в базе.
    console.error(`[notifyCustomerAboutStatus] заказ ${orderId}:`, error);
  }
}

/** Фото собранного букета — то, ради чего клиент и подключает бота. */
export async function sendAssembledPhotoToCustomer(
  orderId: string,
  photoUrl: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let target: { chatId: number; orderNumber: string } | null = null;

  try {
    target = await findChatIdForOrder(orderId);
  } catch (error) {
    console.error(`[sendAssembledPhotoToCustomer] поиск чата, заказ ${orderId}:`, error);
    return { ok: false, reason: "Не удалось определить чат клиента" };
  }

  if (!target) {
    return { ok: false, reason: "Клиент не подключил Telegram-бота — отправить некуда" };
  }

  try {
    await sendPhoto(
      target.chatId,
      photoUrl,
      `💐 Ваш букет по заказу <b>${target.orderNumber}</b> готов!\n\n` +
        `Если что-то хочется поправить — напишите нам до выезда курьера: ${CONTACTS.phone}`
    );
    return { ok: true };
  } catch (error) {
    console.error(`[sendAssembledPhotoToCustomer] отправка, заказ ${orderId}:`, error);
    return { ok: false, reason: "Telegram не принял фото. Попробуйте ещё раз." };
  }
}

/**
 * Просьба об отзыве — через сутки после доставки.
 *
 * Развилка сознательная: довольным предлагаем публичный отзыв на Яндекс.Картах
 * (он и приводит новых клиентов), недовольных зовём написать НАМ. Так проблема
 * решается в переписке, а не превращается сразу в публичную единицу.
 */
export async function askForReview(orderId: string): Promise<boolean> {
  try {
    const target = await findChatIdForOrder(orderId);
    if (!target) return false;

    await sendMessage(
      target.chatId,
      `Здравствуйте! Вчера мы доставили ваш заказ <b>${target.orderNumber}</b>.\n\n` +
        `Всё ли понравилось?\n\n` +
        `Если да — нам очень поможет ваш отзыв на Яндекс.Картах: ${CONTACTS.yandexReviewUrl}\n\n` +
        `Если что-то не так — просто ответьте на это сообщение, разберёмся.`
    );

    // Обещание «ответьте — разберёмся» надо чем-то обеспечить. Без этой
    // отметки ответ клиента проваливался в общую ветку обработчика, и
    // на жалобу бот отвечал меню «Выберите действие:», а сам текст не
    // сохранялся и никому не уходил. Состояние снимается первым же
    // сообщением — см. вебхук, ветка awaiting_review_reply.
    await setSession(target.chatId, "awaiting_review_reply", {
      orderId,
      orderNumber: target.orderNumber,
    });

    return true;
  } catch (error) {
    console.error(`[askForReview] заказ ${orderId}:`, error);
    return false;
  }
}

/**
 * Ответ клиента на просьбу об отзыве: сохранить и передать студии.
 *
 * Кладём в contact_requests, а не в отдельную таблицу: по сути это то же
 * самое — сообщение клиента, которое обязан прочитать человек. Заодно
 * бесплатно достаётся вся вчерашняя обвязка: раздел в админке, добор
 * недоставленных уведомлений и контроль здоровья.
 *
 * Сохраняем ДО отправки, как и везде: если Telegram недоступен, жалоба
 * всё равно останется в базе и будет видна. Возвращаем признак «дошло до
 * студии сразу» только для того, чтобы проставить staff_notified_at, —
 * клиенту в любом случае отвечаем, что приняли.
 */
export async function saveOrderFeedback(
  orderId: string,
  orderNumber: string,
  text: string
): Promise<boolean> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("customer_name, customer_phone")
    .eq("id", orderId)
    .maybeSingle();

  const { data: saved, error: saveError } = await supabaseAdmin
    .from("contact_requests")
    .insert({
      name: order?.customer_name ?? "Клиент",
      phone: order?.customer_phone ?? "—",
      message: text,
      source: "bot_review",
      order_id: orderId,
    })
    .select("id")
    .single();

  if (saveError) {
    console.error(`[saveOrderFeedback] заказ ${orderNumber}:`, saveError.message);
    return false;
  }

  const delivered = await notifyStaffTelegram(
    `💬 <b>Отзыв о заказе ${escapeTelegramHtml(orderNumber)}</b>\n\n` +
      `Клиент: ${escapeTelegramHtml(order?.customer_name ?? "—")}, ` +
      `${escapeTelegramHtml(order?.customer_phone ?? "—")}\n\n` +
      `${escapeTelegramHtml(text)}\n\n` +
      `Человек ответил на нашу просьбу рассказать, как всё прошло. Стоит связаться.`
  );

  if (delivered) {
    await supabaseAdmin
      .from("contact_requests")
      .update({ staff_notified_at: new Date().toISOString(), notify_attempts: 1 })
      .eq("id", saved.id);
  } else {
    await supabaseAdmin.from("contact_requests").update({ notify_attempts: 1 }).eq("id", saved.id);
  }

  return delivered;
}

/**
 * Заказы, у которых пора спросить отзыв.
 *
 * Сутки после доставки — намеренная пауза: сразу после вручения человек
 * ещё не понял, как букет стоит, а через неделю уже забыл. Спрашиваем
 * один раз, отметка review_requested_at это и гарантирует.
 */
export async function findOrdersAwaitingReview(limit = 20): Promise<string[]> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select("id")
    .eq("status", "completed")
    .is("review_requested_at", null)
    .lt("updated_at", dayAgo)
    .limit(limit);

  if (error) {
    console.error("[findOrdersAwaitingReview]", error.message);
    return [];
  }
  return (data ?? []).map((row) => row.id as string);
}

/**
 * Помечаем, что спросили — независимо от того, дошло сообщение или нет.
 *
 * Если у клиента нет бота, повторять попытку бессмысленно: он не появится
 * задним числом. Без отметки такой заказ перебирался бы в каждом прогоне
 * планировщика вечно.
 */
export async function markReviewRequested(orderId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("orders")
    .update({ review_requested_at: new Date().toISOString() })
    .eq("id", orderId);

  if (error) console.error(`[markReviewRequested] заказ ${orderId}:`, error.message);
}

/**
 * Подтверждение сразу после оформления.
 *
 * До этого клиент не получал НИЧЕГО: уведомление уходило только флористам,
 * а человек, оставивший заказ, узнавал о его судьбе, лишь когда кто-то
 * вручную менял статус. Между «нажал оформить» и первым ответом могли
 * пройти часы — и это ровно то время, когда сомневаются и звонят «а вы
 * получили мой заказ?».
 *
 * Вызывается после записи заказа в базу, ошибку наверх не пробрасывает:
 * заказ уже принят, и сорвавшееся сообщение не повод показывать клиенту
 * ошибку оформления.
 */
export async function confirmOrderToCustomer(
  orderId: string,
  details: { deliveryDate: string; timeLabel: string; total: number; isPickup: boolean }
): Promise<void> {
  try {
    const target = await findChatIdForOrder(orderId);
    if (!target) return;

    const when = new Date(details.deliveryDate).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    });

    await sendMessage(
      target.chatId,
      `Спасибо! Мы приняли заказ <b>${target.orderNumber}</b>.\n\n` +
        `${details.isPickup ? "🏪 Самовывоз" : "🚗 Доставка"}: ${when}, ${details.timeLabel}\n` +
        `💰 К оплате: ${details.total} ₽\n\n` +
        `Скоро свяжемся, чтобы подтвердить детали. Здесь же пришлём фото собранного букета до выезда курьера.`
    );
  } catch (error) {
    console.error(`[confirmOrderToCustomer] заказ ${orderId}:`, error);
  }
}
