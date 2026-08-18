import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  sendMessage,
  answerCallbackQuery,
  editMessageText,
  editMessageReplyMarkup,
  type InlineKeyboardMarkup,
} from "@/lib/telegram/bot";
import { parseReminderDate, formatDayMonth } from "@/lib/telegram/date-parse";
import { CONTACTS } from "@/lib/contacts";
import { toE164RussianPhone } from "@/lib/phone-mask";
import { findPosifloraClientByPhone } from "@/lib/posiflora";
import {
  ensureBotUser,
  addReminder,
  listReminders,
  getReminder,
  updateReminder,
  deleteReminder,
  getSession,
  setSession,
  clearSession,
  nextOccurrence,
  type BotReminder,
} from "@/lib/telegram/reminders";

// Node-рантайм ради crypto.timingSafeEqual и service-role supabase-js
// клиента — та же причина, что у остальных внутренних роутов проекта.
export const runtime = "nodejs";

// ================================================================
// Вебхук бота-напоминальщика Floria. Диалог многошаговый (добавить →
// прислать текст с датой → подтверждение), а вебхук Telegram
// стейтлесс — каждое сообщение отдельный HTTP-запрос без памяти о
// предыдущем. Состояние ("жду от этого chat_id дату") хранится в
// таблице bot_sessions (lib/telegram/reminders.ts).
//
// Сама рассылка "через 10 дней после добавления, за N дней до даты"
// сюда не входит — см. app/api/telegram/send-due-reminders, его дёргает
// по расписанию n8n (в этом вебхуке только диалог с пользователем).
// ================================================================

function isValidSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const MAIN_MENU: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: "🎁 Узнать бонусный баланс", callback_data: "bonus_balance" }],
    [{ text: "➕ Добавить напоминание", callback_data: "add" }],
    [{ text: "📋 Мои напоминания", callback_data: "list" }],
    [{ text: "🌐 Наш сайт", url: CONTACTS.siteUrl }],
    [{ text: "📱 Каталог в Telegram", url: CONTACTS.telegram }],
  ],
};

const WELCOME_TEXT =
  "Здравствуйте! 🌸 Я — помощник студии цветов Floria в Симферополе.\n\n" +
  "Подскажу баланс бонусов, заранее напомню о дне рождения или годовщине, " +
  "чтобы вы точно успели с букетом, и помогу быстрее оформить заказ.\n\n" +
  "С чего начнём?";

const ADD_PROMPT =
  "Напишите, что и когда напомнить, одним сообщением.\n\n" +
  "Например: «День рождения жены 17.08» или «Годовщина 5 марта».";

const PARSE_ERROR_TEXT =
  "Не нашёл дату в сообщении 🤔 Укажите её числом (17.08) или словами (17 августа), например: «День рождения жены 17.08».";

const BONUS_PHONE_PROMPT =
  "Введите номер телефона, на который оформлялись заказы (или который " +
  "зарегистрирован в студии) — пришлю баланс бонусов.\n\n" +
  "Например: +7 978 123-45-67";

const BONUS_INVALID_PHONE_TEXT =
  "Не похоже на номер телефона 🤔 Введите 10 цифр после +7, например: +7 978 123-45-67";

const BONUS_ERROR_TEXT = "Не получилось проверить баланс — сервис временно недоступен. Попробуйте чуть позже 🙏";

function formatPhoneForDisplay(e164: string): string {
  // +79781234567 → +7 978 123-45-67
  const d = e164.slice(2);
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}

type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
};

function reminderCard(reminder: BotReminder): { text: string; replyMarkup: InlineKeyboardMarkup } {
  const occurrence = nextOccurrence(reminder.eventDay, reminder.eventMonth);
  return {
    text: `🌷 <b>${escapeHtml(reminder.title)}</b>\nНапомню за ${reminder.remindDaysBefore} дн. до ${formatDayMonth(
      reminder.eventDay,
      reminder.eventMonth
    )} (${occurrence.getUTCFullYear()})`,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "✏️ Изменить", callback_data: `edit:${reminder.id}` },
          { text: "🗑 Удалить", callback_data: `delete:${reminder.id}` },
        ],
      ],
    },
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function handleMessage(message: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  const chatId = message.chat.id;
  const text = message.text?.trim() ?? "";

  await ensureBotUser(chatId, message.from?.first_name, message.from?.username);

  if (text.startsWith("/start")) {
    await clearSession(chatId);
    await sendMessage(chatId, WELCOME_TEXT, MAIN_MENU);
    return;
  }

  const session = await getSession(chatId);

  if (session.state === "awaiting_add") {
    const parsed = parseReminderDate(text);
    if (!parsed) {
      await sendMessage(chatId, PARSE_ERROR_TEXT);
      return;
    }

    const reminder = await addReminder(chatId, text, parsed.day, parsed.month);
    await clearSession(chatId);

    if (!reminder) {
      await sendMessage(chatId, "Не получилось сохранить, попробуйте ещё раз.", MAIN_MENU);
      return;
    }

    await sendMessage(
      chatId,
      `Готово! Напомню за ${reminder.remindDaysBefore} дней до ${formatDayMonth(parsed.day, parsed.month)} 🌷`,
      MAIN_MENU
    );
    return;
  }

  if (session.state === "awaiting_edit") {
    const editingId = session.pending.editingId as string | undefined;
    const parsed = parseReminderDate(text);

    if (!editingId) {
      await clearSession(chatId);
      await sendMessage(chatId, "Что-то пошло не так, начните заново.", MAIN_MENU);
      return;
    }
    if (!parsed) {
      await sendMessage(chatId, PARSE_ERROR_TEXT);
      return;
    }

    const ok = await updateReminder(editingId, chatId, text, parsed.day, parsed.month);
    await clearSession(chatId);

    await sendMessage(
      chatId,
      ok
        ? `Обновил: напомню за 10 дней до ${formatDayMonth(parsed.day, parsed.month)} 🌷`
        : "Не получилось обновить, попробуйте ещё раз.",
      MAIN_MENU
    );
    return;
  }

  if (session.state === "awaiting_phone") {
    await handleBonusBalanceLookup(chatId, text);
    return;
  }

  // idle + произвольный текст — просто показываем меню, не пытаемся угадать намерение.
  await sendMessage(chatId, "Выберите действие:", MAIN_MENU);
}

/**
 * Проверка баланса по номеру — спрашивает Posiflora напрямую (не наш
 * кэш customers), потому что бонусная карта могла завестись и в
 * шоуруме, без единого захода на сайт. Ошибка Posiflora не должна
 * выглядеть как "такого номера нет" — это разные ответы пользователю.
 */
async function handleBonusBalanceLookup(chatId: number, rawText: string): Promise<void> {
  const phone = toE164RussianPhone(rawText);
  if (!phone) {
    // Сессию не сбрасываем — тот же приём, что у awaiting_add/awaiting_edit
    // при ошибке разбора: следующее сообщение можно сразу слать поправленным.
    await sendMessage(chatId, BONUS_INVALID_PHONE_TEXT);
    return;
  }

  await clearSession(chatId);
  const displayPhone = formatPhoneForDisplay(phone);

  let client: { posifloraClientId: string; bonusBalance: number } | null;
  try {
    client = await findPosifloraClientByPhone(phone);
  } catch (error) {
    console.error("[handleBonusBalanceLookup]", error);
    await sendMessage(chatId, BONUS_ERROR_TEXT, MAIN_MENU);
    return;
  }

  if (!client) {
    await sendMessage(
      chatId,
      `Не нашли номер ${displayPhone} в нашей базе 🤔\n\n` +
        "Зарегистрируйтесь на сайте — это займёт меньше минуты, и бонусы начнут копиться с первого заказа.",
      { inline_keyboard: [[{ text: "Зарегистрироваться", url: `${CONTACTS.siteUrl}/login` }]] }
    );
    return;
  }

  await sendMessage(
    chatId,
    `🎁 Баланс бонусов по номеру ${displayPhone}: <b>${client.bonusBalance} ₽</b>\n\n` +
      "Можно списать их при оформлении букета на сайте — просто укажите этот же номер при заказе.",
    { inline_keyboard: [[{ text: "🌷 Выбрать букет", url: `${CONTACTS.siteUrl}/catalog` }]] }
  );
}

async function handleCallbackQuery(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>
): Promise<void> {
  const chatId = callbackQuery.message?.chat.id;
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data ?? "";

  if (!chatId || !messageId) {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  await ensureBotUser(chatId, callbackQuery.from.first_name, callbackQuery.from.username);

  if (data === "add") {
    await setSession(chatId, "awaiting_add");
    await answerCallbackQuery(callbackQuery.id);
    await sendMessage(chatId, ADD_PROMPT);
    return;
  }

  if (data === "bonus_balance") {
    await setSession(chatId, "awaiting_phone");
    await answerCallbackQuery(callbackQuery.id);
    await sendMessage(chatId, BONUS_PHONE_PROMPT);
    return;
  }

  if (data === "list") {
    await answerCallbackQuery(callbackQuery.id);
    const reminders = await listReminders(chatId);

    if (reminders.length === 0) {
      await sendMessage(chatId, "Напоминаний пока нет.", MAIN_MENU);
      return;
    }

    for (const reminder of reminders) {
      const { text, replyMarkup } = reminderCard(reminder);
      await sendMessage(chatId, text, replyMarkup);
    }
    return;
  }

  if (data.startsWith("edit:")) {
    const id = data.slice("edit:".length);
    const reminder = await getReminder(id, chatId);
    await answerCallbackQuery(callbackQuery.id);

    if (!reminder) {
      await sendMessage(chatId, "Это напоминание уже не найдено.", MAIN_MENU);
      return;
    }

    await setSession(chatId, "awaiting_edit", { editingId: id });
    await sendMessage(
      chatId,
      `Сейчас: «${escapeHtml(reminder.title)}» (${formatDayMonth(reminder.eventDay, reminder.eventMonth)}).\n\n` +
        "Пришлите новый текст с датой — целиком, одним сообщением."
    );
    return;
  }

  if (data.startsWith("delete_confirm:")) {
    const id = data.slice("delete_confirm:".length);
    await deleteReminder(id, chatId);
    await answerCallbackQuery(callbackQuery.id, "Удалено");
    await editMessageText(chatId, messageId, "Удалено ✅");
    return;
  }

  if (data.startsWith("delete_cancel:")) {
    const id = data.slice("delete_cancel:".length);
    await answerCallbackQuery(callbackQuery.id, "Отменено");
    await editMessageReplyMarkup(chatId, messageId, {
      inline_keyboard: [
        [
          { text: "✏️ Изменить", callback_data: `edit:${id}` },
          { text: "🗑 Удалить", callback_data: `delete:${id}` },
        ],
      ],
    });
    return;
  }

  if (data.startsWith("delete:")) {
    const id = data.slice("delete:".length);
    await answerCallbackQuery(callbackQuery.id);
    await editMessageReplyMarkup(chatId, messageId, {
      inline_keyboard: [
        [
          { text: "Да, удалить", callback_data: `delete_confirm:${id}` },
          { text: "Отмена", callback_data: `delete_cancel:${id}` },
        ],
      ],
    });
    return;
  }

  await answerCallbackQuery(callbackQuery.id);
}

export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("TELEGRAM_WEBHOOK_SECRET не задан в переменных окружения");
    return NextResponse.json({ error: "Бот не настроен" }, { status: 500 });
  }

  const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!isValidSecret(receivedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
  }

  // Всегда отвечаем 200, даже если внутри что-то упало — иначе Telegram
  // будет бесконечно ретраить один и тот же update.
  try {
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
  } catch (error) {
    console.error("[telegram webhook]", error);
  }

  return new NextResponse(null, { status: 200 });
}
