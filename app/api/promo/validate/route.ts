import { NextResponse } from "next/server";
import { validatePromoCode } from "@/lib/promo-codes";
import { toE164RussianPhone } from "@/lib/phone-mask";

// Тот же node-рантайм, что и у /api/orders — тут тоже читаем через
// service-role клиент (lib/promo-codes.ts).
export const runtime = "nodejs";

type ValidateBody = {
  code?: string;
  customerPhone?: string;
  itemsTotal?: number;
};

/**
 * Живая проверка промокода на странице оформления заказа — до того, как
 * клиент нажал "Оформить". Финальная проверка всё равно происходит
 * заново в /api/orders при создании заказа, эта — только для UX
 * ("промокод применён, −300 ₽"), результату отсюда сервер при
 * оформлении не доверяет.
 */
export async function POST(request: Request) {
  let body: ValidateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Невалидный JSON в теле запроса" }, { status: 400 });
  }

  if (!body.code?.trim()) {
    return NextResponse.json({ error: "Введите промокод" }, { status: 400 });
  }

  const phone = body.customerPhone ? toE164RussianPhone(body.customerPhone) : null;
  if (!phone) {
    return NextResponse.json({ error: "Сначала укажите ваш телефон" }, { status: 400 });
  }

  const itemsTotal = typeof body.itemsTotal === "number" && Number.isFinite(body.itemsTotal) ? body.itemsTotal : 0;

  const result = await validatePromoCode(body.code, phone, itemsTotal);

  if (!result.valid) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ discountAmount: result.discountAmount });
}
