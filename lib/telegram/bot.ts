// ================================================================
// Тонкая обёртка над Telegram Bot API. Используется и вебхуком
// (app/api/telegram/webhook), и cron-эндпоинтом рассылки напоминаний
// (app/api/telegram/send-due-reminders), и рассылкой из админки.
// ================================================================

const TELEGRAM_API_BASE = "https://api.telegram.org";

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

async function callTelegramApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
