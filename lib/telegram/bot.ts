// ================================================================
// Тонкая обёртка над Telegram Bot API. Используется и вебхуком
// (app/api/telegram/webhook), и cron-эндпоинтом рассылки напоминаний
// (app/api/telegram/send-due-reminders), и рассылкой из админки.
//
// Исходящие запросы идут через supabase/functions/telegram-relay —
// прямая сеть с этого VPS до api.telegram.org временами обрывается
// (эффект блокировки Telegram в РФ, ловит именно его IP/протокол).
// Relay работает на инфраструктуре Supabase Edge Functions (Deno
// Deploy) — туда с этого сервера всё стабильно, а оттуда до Telegram
// уже обычный, не помеченный трафик. TELEGRAM_API_BASE — override на
// случай отладки (вернуть на api.telegram.org напрямую).
// ================================================================

const TELEGRAM_API_BASE =
  process.env.TELEGRAM_API_BASE ?? "https://qgogldtdzhyqiarvpgwk.supabase.co/functions/v1/telegram-relay";

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly errorCode?: number
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан в переменных окружения");
  return token;
}

export type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

// Сеть до api.telegram.org с этого сервера временами подвисает (см.
// комментарий в lib/n8n.ts про соединения из контейнера n8n) — без
// таймаута fetch может зависнуть на неопределённое время вместо быстрой
// ошибки, а именно это и выглядит для пользователя как "бот не отвечает
// по 3 минуты". 8с — с запасом больше обычного времени ответа Telegram
// (обычно <1с), но не настолько долго, чтобы веб-хук сам не успел
// ответить Telegram до его собственного таймаута. Один повтор — только
// на сетевую ошибку/таймаут (fetch бросает исключение), не на ответ
// Telegram "не ок" (за тем же запросом может стоять реальная ошибка,
// повторять которую бессмысленно и рискованно для sendMessage — двойное
// сообщение хуже, чем однократная ошибка, но лучше, чем 3 минуты тишины).
const TELEGRAM_TIMEOUT_MS = 8000;

async function callTelegramApiOnce<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
  });

  const json = (await response.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
    error_code?: number;
  };

  if (!json.ok) {
    throw new TelegramApiError(json.description ?? `Telegram API ${method}: HTTP ${response.status}`, json.error_code);
  }

  return json.result as T;
}

async function callTelegramApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await callTelegramApiOnce<T>(method, body);
  } catch (error) {
    if (error instanceof TelegramApiError) throw error;
    // Сетевая ошибка/таймаут (не ответ Telegram) — один быстрый повтор.
    console.warn(`[telegram] ${method} network error, retrying once:`, error);
    return await callTelegramApiOnce<T>(method, body);
  }
}

/**
 * Экранирует спецсимволы Telegram HTML-разметки (parse_mode: "HTML").
 * Обязательна для любого пользовательского текста (имя клиента, адрес,
 * сообщение из формы), который попадает в шаблон уведомления сотрудникам —
 * без неё в чат-е строку типа `<a href="...">текст</a>` из формы заказа
 * можно было бы вставить кликабельную ссылку в сообщение для сотрудника.
 */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<{ message_id: number }> {
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
}

/**
 * photoUrl — публичный URL (например, из Supabase Storage), Telegram сам
 * скачивает файл по ссылке, отдельно загружать байты не нужно. caption
 * ограничен Telegram'ом 1024 символами — длиннее API вернёт ошибку.
 */
export async function sendPhoto(
  chatId: number,
  photoUrl: string,
  caption?: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<{ message_id: number }> {
  return callTelegramApi("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await callTelegramApi("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await callTelegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
}

export async function editMessageReplyMarkup(
  chatId: number,
  messageId: number,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await callTelegramApi("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup ?? { inline_keyboard: [] },
  });
}

export async function deleteMessage(chatId: number, messageId: number): Promise<void> {
  await callTelegramApi("deleteMessage", { chat_id: chatId, message_id: messageId });
}
