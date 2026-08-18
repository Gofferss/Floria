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
    [{ text: "➕ Добавить напоминание", callback_data: "add" }],
    [{ text: "📋 Мои напоминания", callback_data: "list" }],
    [{ text: "🌷 Каталог букетов", url: CONTACTS.telegram }],
  ],
};

const WELCOME_TEXT =
  "Привет! 🌸 Я бот-напоминальщик студии цветов Floria.\n\n" +
  "Помогу не забыть о важных датах — дне рождения, годовщине — и заранее " +
  "напомню, что пора оформить букет.\n\nЧто хотите сделать?";

const ADD_PROMPT =
  "Напишите, что и когда напомнить, одним сообщением.\n\n" +
  "Например: «День рождения жены 17.08» или «Годовщина 5 марта».";

const PARSE_ERROR_TEXT =
  "Не нашёл дату в сообщении 🤔 Укажите её числом (17.08) или словами (17 августа), например: «День рождения жены 17.08».";

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

  // idle + произвольный текст — просто показываем меню, не пытаемся угадать намерение.
  await sendMessage(chatId, "Выберите действие:", MAIN_MENU);
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
      `Сейчас: «${reminder.title}» (${formatDayMonth(reminder.eventDay, reminder.eventMonth)}).\n\n` +
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
