import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { sendOwnerPanel } from "@/lib/telegram/owner-panel";

export const runtime = "nodejs";

// ================================================================
// Прислать панель владельца в чат и записать этот чат как чат владельца.
//
// Только изнутри сервера: тот же секрет, что у задач по расписанию
// (REMINDERS_CRON_SECRET в заголовке x-cron-secret). Запускается разовой
// задачей в контейнере с chat_id владельца. Дальше владелец сам присылает
// панель заново командой /panel — бот выполнит её только в записанном чате.
// ================================================================

function isValidSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.REMINDERS_CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "Секрет не настроен" }, { status: 500 });
  if (!isValidSecret(request.headers.get("x-cron-secret"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let chatId: number;
  try {
    chatId = Number(((await request.json()) as { chatId?: unknown }).chatId);
  } catch {
    return NextResponse.json({ error: "Нужен JSON с chatId" }, { status: 400 });
  }
  // Панель — только в личный чат: виджеты в группах Telegram не показывает.
  if (!Number.isSafeInteger(chatId) || chatId <= 0) return NextResponse.json({ error: "Нужен chatId личного чата" }, { status: 400 });

  try {
    const { messageId } = await sendOwnerPanel(chatId);
    return NextResponse.json({ ok: true, messageId });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error("[owner-panel] не отправилась:", text);
    return NextResponse.json({ error: text }, { status: 502 });
  }
}
