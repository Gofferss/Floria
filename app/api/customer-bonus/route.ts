import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/auth/server";

export const runtime = "nodejs";

/**
 * Живой предпросмотр доступных бонусов на /checkout.
 *
 * РАНЬШЕ принимал ?phone=... и отдавал баланс ЛЮБОГО номера без всякой
 * проверки — по сути открытая ручка "узнать чужой баланс бонусов",
 * которой мог воспользоваться кто угодно, зная (или перебирая) номера
 * телефонов. Теперь баланс отдаётся только для ТЕКУЩЕЙ вошедшей сессии
 * (SMS-код на /login) — свой номер, а не произвольный из query.
 * Гость без входа бонусов не видит и не может ими воспользоваться —
 * см. также /api/orders, где то же самое применяется к списанию.
 */
export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ bonusBalance: 0, loggedIn: false });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("customers")
    .select("bonus_balance")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/customer-bonus]", error.message);
    return NextResponse.json({ bonusBalance: 0, loggedIn: true });
  }

  const raw = data?.bonus_balance;
  const bonusBalance = typeof raw === "string" ? Number.parseFloat(raw) : raw ?? 0;

  return NextResponse.json({ bonusBalance: Number.isFinite(bonusBalance) ? bonusBalance : 0, loggedIn: true });
}
