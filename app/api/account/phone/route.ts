import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/server";
import { linkAuthenticatedCustomerToPhone } from "@/lib/customer-sync";
import { verifyPhoneOtp } from "@/lib/auth/otp";
import { toE164RussianPhone } from "@/lib/phone-mask";

// Использует getSupabaseAdmin() внутри linkAuthenticatedCustomerToPhone —
// обычный supabase-js service-role клиент, Node-рантайм.
export const runtime = "nodejs";

/**
 * Заменяет прежний сбор телефона через Telegram-бота (вебхук удалён
 * вместе с остальным Telegram-кодом при пивоте на VK — см. миграцию 006).
 * VK OAuth номер телефона не отдаёт, поэтому клиент вводит его сам здесь.
 *
 * ВАЖНО: раньше номер привязывался сразу, без проверки, что он реально
 * принадлежит вошедшему — linkAuthenticatedCustomerToPhone при совпадении
 * номера с уже существующей карточкой клиента переносит на неё историю
 * заказов и бонусный баланс, так что без подтверждения кодом это было
 * равносильно перехвату чужого аккаунта по одному только известному
 * номеру телефона (найдено при аудите 2026-08-20). Код отправляется
 * через /api/account/phone/send-code — сюда приходит вместе с ним.
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
  const code = (body as { code?: unknown })?.code;
  const phone = typeof rawPhone === "string" ? toE164RussianPhone(rawPhone) : null;

  if (!phone) {
    return NextResponse.json({ error: "Проверьте номер телефона" }, { status: 400 });
  }
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "Введите код из СМС" }, { status: 400 });
  }

  const verified = await verifyPhoneOtp(phone, code.trim());
  if (!verified.ok) {
    return NextResponse.json({ error: "Неверный или устаревший код" }, { status: 400 });
  }

  try {
    const { data: profile } = await supabase
      .from("customers")
      .select("full_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    const result = await linkAuthenticatedCustomerToPhone(user.id, phone, profile?.full_name);

    return NextResponse.json({
      ok: true,
      bonusBalance: result.bonusBalance,
    });
  } catch (error) {
    console.error("Не удалось сохранить телефон / связать с Posiflora:", error);
    return NextResponse.json({ error: "Не удалось сохранить номер, попробуйте ещё раз" }, { status: 500 });
  }
}
