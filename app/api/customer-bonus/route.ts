import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { toE164RussianPhone } from "@/lib/phone-mask";

export const runtime = "nodejs";

/**
 * Живой предпросмотр доступных бонусов на /checkout, по мере ввода
 * телефона. Только чтение — в отличие от resolveOrCreateCustomerByPhone
 * (используется на POST /api/orders), НЕ создаёт клиента, если такого
 * телефона ещё нет: не хотим заводить карточку клиента только за то, что
 * кто-то напечатал номер и не оформил заказ. Реальный лимit списания
 * всё равно на POST /api/orders пересчитывается заново.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawPhone = searchParams.get("phone") ?? "";
  const phone = toE164RussianPhone(rawPhone);

  if (!phone) {
    return NextResponse.json({ bonusBalance: 0 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("customers")
    .select("bonus_balance")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/customer-bonus]", error.message);
    return NextResponse.json({ bonusBalance: 0 });
  }

  const raw = data?.bonus_balance;
  const bonusBalance = typeof raw === "string" ? Number.parseFloat(raw) : raw ?? 0;

  return NextResponse.json({ bonusBalance: Number.isFinite(bonusBalance) ? bonusBalance : 0 });
}
