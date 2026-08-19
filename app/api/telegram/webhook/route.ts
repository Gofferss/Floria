import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  sendMessage,
  editMessageText,
  editMessageReplyMarkup,
  deleteMessage,
  answerCallbackQuery,
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
  nextOccurrence,
  type BotReminder,
  type BotSession,
} from "@/lib/telegram/reminders";

// Node-рантайм ради crypto.timingSafeEqual и service-role supabase-js
// клиента — та же причина, что у остальных внутренних роутов проекта.
export const runtime = "nodejs";

// ================================================================
// Вебхук бота-напоминальщика Floria. Диалог многошаговый, а вебхук
// Telegram стейтлесс — состояние между сообщениями хранится в таблице
// bot_sessions (lib/telegram/reminders.ts), включая id "рабочего"
// сообщения (pending.menuMessageId): вместо того чтобы на каждый шаг
// слать новое сообщение, бот держит только ОДНО активное своё сообщение
// и меняет его — см. render() и RenderMode ниже. Два способа "сменить
// экран", по источнику события:
//
//   - клик по кнопке (callback_query) → EDIT на месте (editMessageText).
//     Пользователь и так смотрит именно в это сообщение — тут это и
//     быстро, и не дёргает скролл.
//   - ответ обычным текстом (дата, телефон, число дней) → DELETE
//     старого рабочего сообщения + отправка нового. Если вместо этого
//     редактировать старое, оно рискует остаться далеко вверху экрана,
//     пока сообщения самого пользователя (а их бывает несколько подряд,
//     если он не сразу попал в нужный формат) уезжают вниз — тогда
//     кажется, что бот не отвечает, хотя он просто "ответил" где-то
//     невидимо в истории чата. Удаление+новое сообщение держит ответ
//     бота рядом с тем, что печатает пользователь, и при этом в чате
//     всё равно висит только одно сообщение бота одновременно — то же
//     сокращение "простыни", просто отслеживающее место, а не только
//     количество сообщений.
//
// Текст, который печатает сам пользователь, никогда не трогаем —
// удаляется только СВОЁ сообщение бота, и только предыдущее рабочее.
//
// Сама рассылка "за N дней до даты" сюда не входит — см.
// app/api/telegram/send-due-reminders, его дёргает по расписанию n8n
// (в этом вебхуке только диалог с пользователем).
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

const CANCEL_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [[{ text: "◀️ Отмена", callback_data: "menu" }]],
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

const REMIND_DAYS_PICKS = [3, 7, 10, 14, 30];

function remindDaysPromptText(day: number, month: number): string {
  return (
    `За сколько дней до ${formatDayMonth(day, month)} напомнить?\n\n` +
    "Выберите вариант или напишите своё число, например: 21."
  );
}

function remindDaysKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      REMIND_DAYS_PICKS.map((n) => ({ text: `${n}`, callback_data: `remind_days:${n}` })),
      [{ text: "◀️ Отмена", callback_data: "menu" }],
    ],
  };
}

const REMIND_DAYS_INVALID_TEXT = "Нужно целое число от 1 до 365 🤔 Сколько дней напомнить заранее?";

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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

/**
 * "edit" — событие пришло из клика по кнопке, messageId точно известен
 * (Telegram присылает его в самом callback_query) и точно свежий.
 * "fresh" — событие пришло из текста пользователя; oldMessageId — то,
 * что было активным рабочим сообщением до этого (может быть null,
 * если это первое сообщение вообще).
 */
type RenderMode = { kind: "edit"; messageId: number } | { kind: "fresh"; oldMessageId: number | null };

/**
 * Единая точка показа "рабочего экрана" — см. RenderMode и комментарий
 * в начале файла. Вызывающий код каждый раз обязан сохранить
 * возвращённый id обратно в сессию (pending.menuMessageId).
 */
async function render(chatId: number, mode: RenderMode, text: string, keyboard?: InlineKeyboardMarkup): Promise<number> {
  if (mode.kind === "edit") {
    try {
      await editMessageText(chatId, mode.messageId, text, keyboard);
      return mode.messageId;
    } catch (error) {
      console.warn("[render] edit failed, falling back to delete+send:", error);
    }
  }

  const staleId = mode.kind === "edit" ? mode.messageId : mode.oldMessageId;
  if (staleId) {
    try {
      await deleteMessage(chatId, staleId);
    } catch (error) {
      console.warn("[render] delete of stale message failed (likely already gone):", error);
    }
  }
  const sent = await sendMessage(chatId, text, keyboard);
  return sent.message_id;
}

function menuMessageIdOf(session: BotSession): number | null {
  const id = session.pending.menuMessageId;
  return typeof id === "number" ? id : null;
}

function remindersListText(reminders: BotReminder[]): string {
  if (reminders.length === 0) return "Напоминаний пока нет.";
  return reminders
    .map((r, i) => {
      const occurrence = nextOccurrence(r.eventDay, r.eventMonth);
      return (
        `${i + 1}. <b>${escapeHtml(r.title)}</b>\n` +
        `Напомню за ${r.remindDaysBefore} дн. до ${formatDayMonth(r.eventDay, r.eventMonth)} (${occurrence.getUTCFullYear()})`
      );
    })
    .join("\n\n");
}

function remindersListKeyboard(reminders: BotReminder[], confirmDeleteId?: string): InlineKeyboardMarkup {
  const rows = reminders.map((r, i) => {
    if (r.id === confirmDeleteId) {
      return [
        { text: "Да, удалить", callback_data: `delete_confirm:${r.id}` },
        { text: "Отмена", callback_data: `delete_cancel:${r.id}` },
      ];
    }
    return [
      { text: `✏️ ${i + 1}`, callback_data: `edit:${r.id}` },
      { text: `🗑 ${i + 1}`, callback_data: `delete:${r.id}` },
    ];
  });
  rows.push([{ text: "◀️ Меню", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

async function showMainMenu(chatId: number, mode: RenderMode): Promise<void> {
  const newId = await render(chatId, mode, WELCOME_TEXT, MAIN_MENU);
  await setSession(chatId, "idle", { menuMessageId: newId });
}

async function startAddFlow(chatId: number, mode: RenderMode): Promise<void> {
  const newId = await render(chatId, mode, ADD_PROMPT, CANCEL_KEYBOARD);
  await setSession(chatId, "awaiting_add", { menuMessageId: newId });
}

async function startBonusFlow(chatId: number, mode: RenderMode): Promise<void> {
  const newId = await render(chatId, mode, BONUS_PHONE_PROMPT, CANCEL_KEYBOARD);
  await setSession(chatId, "awaiting_phone", { menuMessageId: newId });
}

async function showReminders(chatId: number, mode: RenderMode): Promise<void> {
  const reminders = await listReminders(chatId);
  const newId = await render(chatId, mode, remindersListText(reminders), remindersListKeyboard(reminders));
  await setSession(chatId, "idle", { menuMessageId: newId });
}

/** Общий финальный шаг для "добавить" и "изменить" — оба доходят сюда после выбора срока напоминания. */
async function finalizeReminder(chatId: number, session: BotSession, remindDaysBefore: number, mode: RenderMode): Promise<void> {
  const pending = session.pending as {
    mode?: "add" | "edit";
    title?: string;
    day?: number;
    month?: number;
    editingId?: string;
  };

  if (!pending.title || !pending.day || !pending.month) {
    const newId = await render(chatId, mode, "Что-то пошло не так, начните заново.", MAIN_MENU);
    await setSession(chatId, "idle", { menuMessageId: newId });
    return;
  }

  let resultText: string;
  if (pending.mode === "edit" && pending.editingId) {
    const ok = await updateReminder(pending.editingId, chatId, pending.title, pending.day, pending.month, remindDaysBefore);
    resultText = ok
      ? `Обновил: напомню за ${remindDaysBefore} дн. до ${formatDayMonth(pending.day, pending.month)} 🌷`
      : "Не получилось обновить, попробуйте ещё раз.";
  } else {
    const reminder = await addReminder(chatId, pending.title, pending.day, pending.month, remindDaysBefore);
    resultText = reminder
      ? `Готово! Напомню за ${remindDaysBefore} дн. до ${formatDayMonth(pending.day, pending.month)} 🌷`
      : "Не получилось сохранить, попробуйте ещё раз.";
  }

  const newId = await render(chatId, mode, resultText, MAIN_MENU);
  await setSession(chatId, "idle", { menuMessageId: newId });
}

/**
 * Проверка баланса по номеру — спрашивает Posiflora напрямую (не наш
 * кэш customers), потому что бонусная карта могла завестись и в
 * шоуруме, без единого захода на сайт. Ошибка Posiflora не должна
 * выглядеть как "такого номера нет" — это разные ответы пользователю.
 * Всегда вызывается в ответ на текст пользователя — mode всегда "fresh".
 */
async function handleBonusBalanceLookup(chatId: number, rawText: string, oldMessageId: number | null): Promise<void> {
  const phone = toE164RussianPhone(rawText);
  if (!phone) {
    // Сессию не сбрасываем — следующее сообщение можно сразу слать поправленным.
    const newId = await render(chatId, { kind: "fresh", oldMessageId }, BONUS_INVALID_PHONE_TEXT, CANCEL_KEYBOARD);
    await setSession(chatId, "awaiting_phone", { menuMessageId: newId });
    return;
  }

  const displayPhone = formatPhoneForDisplay(phone);

  let client: { posifloraClientId: string; bonusBalance: number } | null;
  try {
    client = await findPosifloraClientByPhone(phone);
  } catch (error) {
    console.error("[handleBonusBalanceLookup]", error);
    const newId = await render(chatId, { kind: "fresh", oldMessageId }, BONUS_ERROR_TEXT, MAIN_MENU);
    await setSession(chatId, "idle", { menuMessageId: newId });
    return;
  }

  if (!client) {
    const newId = await render(
      chatId,
      { kind: "fresh", oldMessageId },
      `Не нашли номер ${displayPhone} в нашей базе 🤔\n\n` +
        "Зарегистрируйтесь на сайте — это займёт меньше минуты, и бонусы начнут копиться с первого заказа.",
      {
        inline_keyboard: [
          [{ text: "Зарегистрироваться", url: `${CONTACTS.siteUrl}/login` }],
          [{ text: "◀️ Меню", callback_data: "menu" }],
        ],
      }
    );
    await setSession(chatId, "idle", { menuMessageId: newId });
    return;
  }

  const newId = await render(
    chatId,
    { kind: "fresh", oldMessageId },
    `🎁 Баланс бонусов по номеру ${displayPhone}: <b>${client.bonusBalance} ₽</b>\n\n` +
      "Можно списать их при оформлении букета на сайте — просто укажите этот же номер при заказе.",
    {
      inline_keyboard: [
        [{ text: "🌷 Выбрать букет", url: `${CONTACTS.siteUrl}/catalog` }],
        [{ text: "◀️ Меню", callback_data: "menu" }],
      ],
    }
  );
  await setSession(chatId, "idle", { menuMessageId: newId });
}

async function handleMessage(message: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  const chatId = message.chat.id;
  const text = message.text?.trim() ?? "";

  await ensureBotUser(chatId, message.from?.first_name, message.from?.username);

  if (text.startsWith("/start")) {
    // /start тоже отвечает на текст пользователя — тот же приём: убрать
    // старое рабочее сообщение (если было) и прислать новое рядом с текущим.
    const priorSession = await getSession(chatId);
    await showMainMenu(chatId, { kind: "fresh", oldMessageId: menuMessageIdOf(priorSession) });
    return;
  }

  const session = await getSession(chatId);
  const menuMessageId = menuMessageIdOf(session);
  const freshMode: RenderMode = { kind: "fresh", oldMessageId: menuMessageId };

  if (text === "/add" || text.startsWith("/add@")) {
    await startAddFlow(chatId, freshMode);
    return;
  }
  if (text === "/reminders" || text.startsWith("/reminders@")) {
    await showReminders(chatId, freshMode);
    return;
  }
  if (text === "/bonus" || text.startsWith("/bonus@")) {
    await startBonusFlow(chatId, freshMode);
    return;
  }

  if (session.state === "awaiting_add") {
    const parsed = parseReminderDate(text);
    if (!parsed) {
      const newId = await render(chatId, freshMode, PARSE_ERROR_TEXT, CANCEL_KEYBOARD);
      await setSession(chatId, "awaiting_add", { menuMessageId: newId });
      return;
    }

    const newId = await render(chatId, freshMode, remindDaysPromptText(parsed.day, parsed.month), remindDaysKeyboard());
    await setSession(chatId, "awaiting_remind_days", {
      mode: "add",
      title: text,
      day: parsed.day,
      month: parsed.month,
      menuMessageId: newId,
    });
    return;
  }

  if (session.state === "awaiting_edit") {
    const editingId = session.pending.editingId as string | undefined;
    if (!editingId) {
      const newId = await render(chatId, freshMode, "Что-то пошло не так, начните заново.", MAIN_MENU);
      await setSession(chatId, "idle", { menuMessageId: newId });
      return;
    }

    const parsed = parseReminderDate(text);
    if (!parsed) {
      const newId = await render(chatId, freshMode, PARSE_ERROR_TEXT, CANCEL_KEYBOARD);
      await setSession(chatId, "awaiting_edit", { editingId, menuMessageId: newId });
      return;
    }

    const newId = await render(chatId, freshMode, remindDaysPromptText(parsed.day, parsed.month), remindDaysKeyboard());
    await setSession(chatId, "awaiting_remind_days", {
      mode: "edit",
      editingId,
      title: text,
      day: parsed.day,
      month: parsed.month,
      menuMessageId: newId,
    });
    return;
  }

  if (session.state === "awaiting_remind_days") {
    const trimmed = text.trim();
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(n) || n < 1 || n > 365 || String(n) !== trimmed) {
      const newId = await render(chatId, freshMode, REMIND_DAYS_INVALID_TEXT, remindDaysKeyboard());
      await setSession(chatId, "awaiting_remind_days", { ...session.pending, menuMessageId: newId });
      return;
    }
    await finalizeReminder(chatId, session, n, freshMode);
    return;
  }

  if (session.state === "awaiting_phone") {
    await handleBonusBalanceLookup(chatId, text, menuMessageId);
    return;
  }

  // idle + произвольный текст — просто показываем меню, не пытаемся угадать намерение.
  const newId = await render(chatId, freshMode, "Выберите действие:", MAIN_MENU);
  await setSession(chatId, "idle", { menuMessageId: newId });
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
  const session = await getSession(chatId);
  const editMode: RenderMode = { kind: "edit", messageId };

  if (data === "menu") {
    await answerCallbackQuery(callbackQuery.id);
    await showMainMenu(chatId, editMode);
    return;
  }

  if (data === "add") {
    await answerCallbackQuery(callbackQuery.id);
    await startAddFlow(chatId, editMode);
    return;
  }

  if (data === "bonus_balance") {
    await answerCallbackQuery(callbackQuery.id);
    await startBonusFlow(chatId, editMode);
    return;
  }

  if (data === "list") {
    await answerCallbackQuery(callbackQuery.id);
    await showReminders(chatId, editMode);
    return;
  }

  if (data.startsWith("remind_days:")) {
    const n = Number(data.slice("remind_days:".length));
    await answerCallbackQuery(callbackQuery.id);
    if (session.state !== "awaiting_remind_days" || !Number.isInteger(n)) {
      await showMainMenu(chatId, editMode);
      return;
    }
    await finalizeReminder(chatId, session, n, editMode);
    return;
  }

  if (data.startsWith("edit:")) {
    const id = data.slice("edit:".length);
    const reminder = await getReminder(id, chatId);
    await answerCallbackQuery(callbackQuery.id);

    if (!reminder) {
      const newId = await render(chatId, editMode, "Это напоминание уже не найдено.", MAIN_MENU);
      await setSession(chatId, "idle", { menuMessageId: newId });
      return;
    }

    const newId = await render(
      chatId,
      editMode,
      `Сейчас: «${escapeHtml(reminder.title)}» (${formatDayMonth(reminder.eventDay, reminder.eventMonth)}, ` +
        `за ${reminder.remindDaysBefore} дн.).\n\nПришлите новый текст с датой — целиком, одним сообщением.`,
      CANCEL_KEYBOARD
    );
    await setSession(chatId, "awaiting_edit", { editingId: id, menuMessageId: newId });
    return;
  }

  if (data.startsWith("delete_confirm:")) {
    const id = data.slice("delete_confirm:".length);
    await deleteReminder(id, chatId);
    await answerCallbackQuery(callbackQuery.id, "Удалено");
    await showReminders(chatId, editMode);
    return;
  }

  if (data.startsWith("delete_cancel:")) {
    await answerCallbackQuery(callbackQuery.id, "Отменено");
    const reminders = await listReminders(chatId);
    await editMessageReplyMarkup(chatId, messageId, remindersListKeyboard(reminders));
    return;
  }

  if (data.startsWith("delete:")) {
    const id = data.slice("delete:".length);
    await answerCallbackQuery(callbackQuery.id);
    const reminders = await listReminders(chatId);
    await editMessageReplyMarkup(chatId, messageId, remindersListKeyboard(reminders, id));
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
