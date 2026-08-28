import { NextResponse } from "next/server";
import { toE164RussianPhone } from "@/lib/phone-mask";
import { notifyN8n, notifyStaffTelegram } from "@/lib/n8n";
import { escapeTelegramHtml } from "@/lib/telegram/bot";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase";

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
// Заявка уходит сотрудникам в Telegram — без лимита этим можно было бы
// завалить рабочий чат и похоронить настоящие заказы. 5 в час с адреса
// с запасом покрывает живого человека, который ошибся и отправил дважды.
const CONTACT_LIMIT = 5;
const CONTACT_WINDOW_MS = 60 * 60 * 1000;

// Телеграм всё равно не примет очень длинное сообщение — ограничиваем на
// входе, чтобы не гонять мегабайты и не мусорить в уведомлениях.
const MAX_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 2000;

export async function POST(request: Request) {
  const limit = rateLimit(`contact:${clientIp(request)}`, CONTACT_LIMIT, CONTACT_WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

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

  const name = payload.name.trim().slice(0, MAX_NAME_LENGTH);
  const message = (payload.message?.trim() ?? "").slice(0, MAX_MESSAGE_LENGTH);

  // ================================================================
  // СНАЧАЛА записываем, ПОТОМ уведомляем — порядок здесь принципиален.
  //
  // Раньше обращение вообще нигде не сохранялось: единственным его следом
  // было сообщение в Telegram, отправленное «вдогонку». Не ушло — и вопрос
  // клиента исчезал совсем, притом что человек видел «спасибо, свяжемся».
  //
  // Теперь запись в базе появляется до всякой отправки. Сбой уведомления
  // перестал быть потерей: обращение лежит в /admin, а задача добора
  // (app/api/telegram/send-due-reminders) доотправит его и поднимет
  // тревогу, если Telegram не отвечает раз за разом.
  // ================================================================
  const supabaseAdmin = getSupabaseAdmin();
  const { data: saved, error: saveError } = await supabaseAdmin
    .from("contact_requests")
    .insert({ name, phone, message })
    .select("id")
    .single();

  if (saveError) {
    // Вот это — единственный случай, когда клиенту нужно сказать «не
    // получилось»: записать не смогли, а значит и вернуться к обращению
    // будет неоткуда. Лучше честная ошибка и повторная отправка, чем
    // бодрое «спасибо» над пустотой.
    console.error("[contact] не удалось сохранить обращение:", saveError.message);
    return NextResponse.json(
      { error: "Не получилось отправить заявку. Попробуйте ещё раз или позвоните нам." },
      { status: 500 }
    );
  }

  notifyN8n({ event: "contact.created", name, phone, message });
  // Экранируем ввод клиента — без этого через поле "Сообщение" в HTML-
  // уведомление сотруднику можно было бы вставить кликабельную ссылку.
  const delivered = await notifyStaffTelegram(
    `📞 <b>Заявка на обратный звонок</b>\n\nИмя: ${escapeTelegramHtml(name)}\nТелефон: ${escapeTelegramHtml(
      phone
    )}\nСообщение: ${message ? escapeTelegramHtml(message) : "—"}`
  );

  if (delivered) {
    await supabaseAdmin
      .from("contact_requests")
      .update({ staff_notified_at: new Date().toISOString(), notify_attempts: 1 })
      .eq("id", saved.id);
  } else {
    // Не сообщаем клиенту: для него заявка принята, и это правда — она
    // записана. Проблема наша, и решать её нам, а не ему.
    console.error(`[contact] обращение ${saved.id} сохранено, но сотрудникам не доставлено`);
    await supabaseAdmin.from("contact_requests").update({ notify_attempts: 1 }).eq("id", saved.id);
  }

  return NextResponse.json({ success: true });
}
