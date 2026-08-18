import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { syncPosifloraCatalog } from "@/lib/posiflora";

// Node-рантайм ради crypto.timingSafeEqual и обычного supabase-js
// service-role клиента (та же причина, что у остальных внутренних
// роутов проекта).
export const runtime = "nodejs";

/**
 * Сравнение секрета — тем же способом (timingSafeEqual), что и у
 * вебхука Telegram и проверки HMAC виджета: длина/содержимое строки
 * не должны влиять на время ответа.
 */
function isValidSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expectedSecret = process.env.CATALOG_SYNC_SECRET;
  if (!expectedSecret) {
    console.error("CATALOG_SYNC_SECRET не задан в переменных окружения");
    return NextResponse.json({ error: "Синхронизация не настроена" }, { status: 500 });
  }

  const receivedSecret = request.headers.get("x-sync-secret");
  if (!isValidSecret(receivedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const summary = await syncPosifloraCatalog();
    const durationMs = Date.now() - startedAt;

    if (summary.errors.length > 0) {
      // Не 500 — часть каталога вполне могла синхронизироваться успешно,
      // это не полный отказ. Ошибки видны и в теле ответа (для n8n), и
      // в логах сервера.
      console.error("Синхронизация каталога завершилась с ошибками:", summary.errors);
    }

    return NextResponse.json({ ok: true, durationMs, ...summary });
  } catch (error) {
    console.error("Синхронизация каталога полностью упала:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Неизвестная ошибка" },
      { status: 500 }
    );
  }
}
