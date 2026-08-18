import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// Node-рантайм ради service-role supabase-js, как у остальных API-роутов.
export const runtime = "nodejs";

const MAX_LENGTH = 200;

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
