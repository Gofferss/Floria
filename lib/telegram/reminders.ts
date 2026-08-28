// ================================================================
// CRUD напоминаний + расчёт "когда следующее ежегодное наступление
// даты" — общая логика для вебхука (добавить/список/изменить/удалить)
// и cron-эндпоинта рассылки (app/api/telegram/send-due-reminders).
// ================================================================

import { getSupabaseAdmin } from "@/lib/supabase";

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function occurrenceInYear(day: number, month: number, year: number): Date {
  // 29 февраля в невисокосный год — сводим к 28-му, а не перескакиваем на
  // март: для дня рождения "28 или 29 февраля" ближе к жизни, чем "1 марта".
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    return new Date(Date.UTC(year, 1, 28));
  }
  return new Date(Date.UTC(year, month - 1, day));
}

/** Ближайшее наступление даты day/month, начиная от from (включительно). */
export function nextOccurrence(day: number, month: number, from: Date = new Date()): Date {
  const fromUTC = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let candidate = occurrenceInYear(day, month, fromUTC.getUTCFullYear());
  if (candidate < fromUTC) {
    candidate = occurrenceInYear(day, month, fromUTC.getUTCFullYear() + 1);
  }
  return candidate;
}

export function daysUntil(target: Date, from: Date = new Date()): number {
  const fromUTC = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  return Math.round((target.getTime() - fromUTC.getTime()) / (1000 * 60 * 60 * 24));
}

export type BotReminder = {
  id: string;
  chatId: number;
  title: string;
  eventDay: number;
  eventMonth: number;
  remindDaysBefore: number;
  lastNotifiedYear: number | null;
};

type BotReminderRow = {
  id: string;
  chat_id: number;
  title: string;
  event_day: number;
  event_month: number;
  remind_days_before: number;
  last_notified_year: number | null;
};

function mapReminder(row: BotReminderRow): BotReminder {
  return {
    id: row.id,
    chatId: row.chat_id,
    title: row.title,
    eventDay: row.event_day,
    eventMonth: row.event_month,
    remindDaysBefore: row.remind_days_before,
    lastNotifiedYear: row.last_notified_year,
  };
}

/** Регистрирует пользователя при /start (или обновляет имя/username) — источник списка для рассылок. */
export async function ensureBotUser(chatId: number, firstName?: string, username?: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("bot_users")
    .upsert(
      { chat_id: chatId, first_name: firstName ?? null, username: username ?? null, is_blocked: false },
      { onConflict: "chat_id" }
    );

  if (error) console.error("[ensureBotUser]", error.message);
}

export async function addReminder(
  chatId: number,
  title: string,
  day: number,
  month: number,
  remindDaysBefore: number
): Promise<BotReminder | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("bot_reminders")
    .insert({ chat_id: chatId, title, event_day: day, event_month: month, remind_days_before: remindDaysBefore })
    .select()
    .single();

  if (error || !data) {
    console.error("[addReminder]", error?.message);
    return null;
  }
  return mapReminder(data);
}

export async function listReminders(chatId: number): Promise<BotReminder[]> {
  const { data, error } = await getSupabaseAdmin().from("bot_reminders").select("*").eq("chat_id", chatId);

  if (error || !data) {
    console.error("[listReminders]", error?.message);
    return [];
  }

  const reminders = data.map(mapReminder);
  reminders.sort(
    (a, b) =>
      daysUntil(nextOccurrence(a.eventDay, a.eventMonth)) - daysUntil(nextOccurrence(b.eventDay, b.eventMonth))
  );
  return reminders;
}

/** chatId в фильтре — принципиально: не даёт получить/менять/удалить чужое напоминание по id. */
export async function getReminder(id: string, chatId: number): Promise<BotReminder | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("bot_reminders")
    .select("*")
    .eq("id", id)
    .eq("chat_id", chatId)
    .maybeSingle();

  if (error || !data) return null;
  return mapReminder(data);
}

export async function updateReminder(
  id: string,
  chatId: number,
  title: string,
  day: number,
  month: number,
  remindDaysBefore: number
): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from("bot_reminders")
    .update({ title, event_day: day, event_month: month, remind_days_before: remindDaysBefore, last_notified_year: null })
    .eq("id", id)
    .eq("chat_id", chatId);

  if (error) console.error("[updateReminder]", error.message);
  return !error;
}

export async function deleteReminder(id: string, chatId: number): Promise<boolean> {
  const { error } = await getSupabaseAdmin().from("bot_reminders").delete().eq("id", id).eq("chat_id", chatId);

  if (error) console.error("[deleteReminder]", error.message);
  return !error;
}

// ---------- Состояние диалога между сообщениями ----------

export type BotSessionState =
  | "idle"
  | "awaiting_add"
  | "awaiting_edit"
  | "awaiting_remind_days"
  | "awaiting_phone"
  | "awaiting_otp_code"
  // Ждём ответ на просьбу об отзыве. Ставится в askForReview, снимается
  // первым же сообщением клиента. Нужно ровно затем, чтобы отличить
  // «человек отвечает на наш вопрос» от «человек тыкает в бота»: раньше
  // ответ на «расскажите, что не так» проваливался в общую ветку и бот
  // выдавал на жалобу меню «Выберите действие:».
  | "awaiting_review_reply";

export type BotSession = {
  state: BotSessionState;
  pending: Record<string, unknown>;
};

export async function getSession(chatId: number): Promise<BotSession> {
  const { data } = await getSupabaseAdmin()
    .from("bot_sessions")
    .select("state, pending")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (!data) return { state: "idle", pending: {} };
  return { state: data.state as BotSessionState, pending: (data.pending as Record<string, unknown>) ?? {} };
}

export async function setSession(
  chatId: number,
  state: BotSessionState,
  pending: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("bot_sessions")
    .upsert({ chat_id: chatId, state, pending }, { onConflict: "chat_id" });

  if (error) console.error("[setSession]", error.message);
}

export async function clearSession(chatId: number): Promise<void> {
  await setSession(chatId, "idle", {});
}

// ---------- Для cron-эндпоинта рассылки напоминаний ----------

export type DueReminder = BotReminder & { occurrence: Date; daysUntilEvent: number };

/** Напоминания, для которых сегодня — ровно remind_days_before дней до наступления. */
export async function findDueReminders(): Promise<DueReminder[]> {
  const { data, error } = await getSupabaseAdmin().from("bot_reminders").select("*");
  if (error || !data) {
    console.error("[findDueReminders]", error?.message);
    return [];
  }

  const today = new Date();
  const due: DueReminder[] = [];

  for (const row of data.map(mapReminder)) {
    const occurrence = nextOccurrence(row.eventDay, row.eventMonth, today);
    const daysUntilEvent = daysUntil(occurrence, today);
    const occurrenceYear = occurrence.getUTCFullYear();

    if (daysUntilEvent === row.remindDaysBefore && row.lastNotifiedYear !== occurrenceYear) {
      due.push({ ...row, occurrence, daysUntilEvent });
    }
  }

  return due;
}

export async function markNotified(id: string, year: number): Promise<void> {
  const { error } = await getSupabaseAdmin().from("bot_reminders").update({ last_notified_year: year }).eq("id", id);
  if (error) console.error("[markNotified]", error.message);
}

// ---------- Для рассылок из /admin/broadcast ----------

export type BotUser = { chatId: number; isBlocked: boolean };

export async function listActiveBotUsers(): Promise<BotUser[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("bot_users")
    .select("chat_id, is_blocked")
    .eq("is_blocked", false);

  if (error || !data) {
    console.error("[listActiveBotUsers]", error?.message);
    return [];
  }
  return data.map((row) => ({ chatId: row.chat_id, isBlocked: row.is_blocked }));
}

export async function markBotUserBlocked(chatId: number): Promise<void> {
  const { error } = await getSupabaseAdmin().from("bot_users").update({ is_blocked: true }).eq("chat_id", chatId);
  if (error) console.error("[markBotUserBlocked]", error.message);
}
