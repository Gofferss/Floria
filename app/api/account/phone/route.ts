import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/server";
import { linkAuthenticatedCustomerToPhone } from "@/lib/customer-sync";
import { isValidPhone } from "@/lib/checkout";

// Использует getSupabaseAdmin() внутри linkAuthenticatedCustomerToPhone —
// обычный supabase-js service-role клиент, Node-рантайм.
export const runtime = "nodejs";

/**
 * Заменяет прежний сбор телефона через Telegram-бота (вебхук удалён
 * вместе с остальным Telegram-кодом при пивоте на VK — см. миграцию 006).
 * VK OAuth номер телефона не отдаёт, поэтому клиент вводит его сам здесь.
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

  const phone = (body as { phone?: unknown })?.phone;
  if (typeof phone !== "string" || !isValidPhone(phone)) {
    return NextResponse.json({ error: "Проверьте номер телефона" }, { status: 400 });
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
