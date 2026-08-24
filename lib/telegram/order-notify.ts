import { getSupabaseAdmin } from "@/lib/supabase";
import { sendMessage, sendPhoto } from "@/lib/telegram/bot";
import { toE164RussianPhone } from "@/lib/phone-mask";
import { CONTACTS } from "@/lib/contacts";

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
    return true;
  } catch (error) {
    console.error(`[askForReview] заказ ${orderId}:`, error);
    return false;
  }
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
