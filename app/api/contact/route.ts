import { NextResponse } from "next/server";
import { toE164RussianPhone } from "@/lib/phone-mask";
import { notifyN8n, notifyStaffTelegram } from "@/lib/n8n";

// Тот же node-рантайм, что и у /api/orders — консистентность важнее, чем
// экономия на edge для такого редкого и лёгкого запроса.
export const runtime = "nodejs";

type ContactPayload = {
  name: string;
  phone: string;
  message: string;
};

/**
 * Заявка "обратный звонок" с /contacts. Специально НЕ создаёт заказ и не
 * трогает orders/customers/Posiflora — это просто обращение, которое нужно
 * увидеть сотруднику в Telegram и на почте (через n8n, event: "contact.created").
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Невалидный JSON в теле запроса" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const payload = body as Partial<ContactPayload>;

  if (!payload.name?.trim()) {
    return NextResponse.json({ error: "Укажите имя" }, { status: 400 });
  }

  const phone = payload.phone ? toE164RussianPhone(payload.phone) : null;
  if (!phone) {
    return NextResponse.json({ error: "Некорректный номер телефона" }, { status: 400 });
  }

  const name = payload.name.trim();
  const message = payload.message?.trim() ?? "";

  notifyN8n({ event: "contact.created", name, phone, message });
  notifyStaffTelegram(
    `📞 <b>Заявка на обратный звонок</b>\n\nИмя: ${name}\nТелефон: ${phone}\nСообщение: ${message || "—"}`
  );

  return NextResponse.json({ success: true });
}
