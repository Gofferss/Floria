import { sendMessage } from "@/lib/telegram/bot";
import { toE164RussianPhone } from "@/lib/phone-mask";
import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Куда доставить код входа: если номер привязан к чату бота — в
// Telegram (бесплатно, без операторов), иначе — обычная СМС (см.
// вызывающий код в app/api/auth/sms-hook/route.ts). Вынесено из
// самого роута отдельным модулем, чтобы можно было дёрнуть напрямую
// при тестировании, не подписывая Standard Webhooks payload заново.
// ================================================================

/**
 * Чат бота, привязанный к этому номеру (bot_users.phone, см.
 * lib/telegram/occasions.ts:linkBotUserPhone) — если пользователь хоть
 * раз подтвердил номер боту (проверка бонуса) или поделился контактом
 * (кнопка "Получать код входа сюда"). bot_users.phone намеренно без
 * unique (один номер мог подтвердить не один чат, например при смене
 * аккаунта) — берём первый попавшийся, для доставки кода этого достаточно.
 */
export async function findLinkedChatId(phone: string): Promise<number | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("bot_users")
    .select("chat_id")
    .eq("phone", phone)
    .eq("is_blocked", false)
    .limit(1);

  if (error) {
    console.error("[otp-delivery] findLinkedChatId:", error.message);
    return null;
  }
  return data?.[0]?.chat_id ?? null;
}

/** true — код ушёл в Telegram, дальше слать СМС не нужно. false — нужен обычный путь через SMS.ru. */
export async function trySendOtpViaTelegram(phone: string, otp: string): Promise<boolean> {
  const normalized = toE164RussianPhone(phone);
  if (!normalized) return false;

  const chatId = await findLinkedChatId(normalized);
  if (!chatId) return false;

  try {
    // Код в <code>, а не в <b>: в официальных клиентах Telegram нажатие на
    // моноширинный блок копирует его в буфер целиком. Жирный текст выглядит
    // почти так же, но копировать его приходится выделением — на телефоне
    // это возня с лупой и маркерами ради шести цифр, которые всё равно
    // проще перенабрать. Отдельная строка — чтобы попасть пальцем в цифры,
    // а не в соседние слова.
    await sendMessage(chatId, `🔐 Код для входа на сайт Floria:\n\n<code>${otp}</code>\n\nНажмите на код, чтобы скопировать.`);
    return true;
  } catch (error) {
    // Не блокируем вход из-за сбоя Telegram — вызывающий код упадёт на обычный SMS.ru.
    console.error("[otp-delivery] доставка кода через Telegram не удалась, пробуем СМС:", error);
    return false;
  }
}
