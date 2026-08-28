import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { syncPosifloraCatalog } from "@/lib/posiflora";
import { reportHealth } from "@/lib/health-report";

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

    if (summary.availabilityErrors.length > 0 || summary.catalogErrors.length > 0) {
      // Не 500 — часть каталога вполне могла синхронизироваться успешно,
      // это не полный отказ. Ошибки видны и в теле ответа, и в логах.
      console.error("Синхронизация каталога завершилась с ошибками:", {
        наличие: summary.availabilityErrors,
        каталог: summary.catalogErrors,
      });
    }

    // ================================================================
    // Две отдельные проверки здоровья вместо одной общей.
    //
    // Раньше тревога поднималась на ЛЮБУЮ ошибку, и из-за вечно
    // падающего /categories у Posiflora счётчик добрался до 66 сбоев
    // подряд. Сообщение при этом было неправдой: пересчёт наличия —
    // то, ради чего задача вообще нужна, — всё это время работал.
    //
    // Тревога, которая горит вторые сутки и на которую нельзя
    // повлиять, хуже отсутствия тревоги: на неё перестают смотреть, а
    // заодно и на соседние. Поэтому теперь:
    //   наличие — порог 3 (45 минут), это наши деньги и наш клиент;
    //   каталог — порог 96 (сутки), поломка чаще всего внешняя, и
    //             сообщать о ней чаще раза в сутки бессмысленно.
    // ================================================================
    await reportHealth({
      key: "catalog-availability",
      title: "Пересчёт наличия по составу букетов",
      ok: summary.availabilityErrors.length === 0,
      errorText: summary.availabilityErrors.join("; "),
      failThreshold: 3,
    });

    await reportHealth({
      key: "catalog-import",
      title: "Импорт товаров из Posiflora",
      ok: summary.catalogErrors.length === 0,
      errorText: summary.catalogErrors.join("; "),
      failThreshold: 96,
    });

    return NextResponse.json({ ok: true, durationMs, ...summary });
  } catch (error) {
    console.error("Синхронизация каталога полностью упала:", error);
    // Полное падение — значит и пересчёт наличия не отработал, поэтому
    // отчитываемся по критичному ключу с его быстрым порогом, а не по
    // терпеливому импортному.
    await reportHealth({
      key: "catalog-availability",
      title: "Пересчёт наличия по составу букетов",
      ok: false,
      errorText: error instanceof Error ? error.message : "Неизвестная ошибка",
      failThreshold: 3,
    });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Неизвестная ошибка" },
      { status: 500 }
    );
  }
}
