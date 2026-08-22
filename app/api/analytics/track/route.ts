import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

// Node-рантайм ради service-role supabase-js, как у остальных API-роутов.
export const runtime = "nodejs";

const MAX_LENGTH = 200;

// Ручка открытая и пишет строку в БД на каждый вызов — без лимита ею
// можно раздуть analytics_events и заодно испортить статистику. Живой
// посетитель за минуту столько событий не набирает даже активно кликая.
const TRACK_LIMIT = 60;
const TRACK_WINDOW_MS = 60 * 1000;

type TrackBody = {
  eventType?: unknown;
  target?: unknown;
  pagePath?: unknown;
};

/**
 * Принимает анонимные события с сайта (клик по кнопке, просмотр товара...).
 * Тело может прийти и через sendBeacon (Blob без явного Content-Type,
 * который браузер иногда отдаёт как text/plain) — поэтому не полагаемся
 * на заголовок, просто пытаемся распарсить как JSON.
 */
export async function POST(request: Request) {
  const limit = rateLimit(`track:${clientIp(request)}`, TRACK_LIMIT, TRACK_WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  let body: TrackBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { eventType, target, pagePath } = body;
  if (
    typeof eventType !== "string" ||
    !eventType.trim() ||
    typeof target !== "string" ||
    !target.trim()
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin().from("analytics_events").insert({
    event_type: eventType.trim().slice(0, MAX_LENGTH),
    target: target.trim().slice(0, MAX_LENGTH),
    page_path: typeof pagePath === "string" ? pagePath.slice(0, MAX_LENGTH) : null,
  });

  if (error) {
    // Не роняем ответ клиенту из-за сбоя метрик — просто логируем.
    console.error("[analytics/track]", error.message);
  }

  return NextResponse.json({ ok: true });
}
