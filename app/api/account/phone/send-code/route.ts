import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/server";
import { sendPhoneOtp } from "@/lib/auth/otp";
import { toE164RussianPhone } from "@/lib/phone-mask";

// Node-рантайм ради sendPhoneOtp (создаёт отдельный supabase-js клиент).
export const runtime = "nodejs";

/**
 * Первый шаг привязки телефона в ЛК (после входа через VK) — только
 * отправляет код. Раньше /api/account/phone принимал номер и СРАЗУ его
 * привязывал, без проверки, что он вообще принадлежит вошедшему —
 * это позволяло привязать (и тем самым перехватить историю заказов
 * и бонусный баланс) ЛЮБОЙ телефон, зная только сам номер. Теперь,
 * как и везде в проекте, где решается судьба бонусов, сначала СМС-код.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
  }

  const rawPhone = (body as { phone?: unknown })?.phone;
  const phone = typeof rawPhone === "string" ? toE164RussianPhone(rawPhone) : null;
  if (!phone) {
    return NextResponse.json({ error: "Проверьте номер телефона" }, { status: 400 });
  }

  const sent = await sendPhoneOtp(phone);
  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
