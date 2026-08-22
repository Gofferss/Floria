import { NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { trySendOtpViaTelegram } from "@/lib/auth/otp-delivery";

// Node-рантайм: используем обычный fetch к SMS.ru, без специфики Edge.
export const runtime = "nodejs";

type SendSmsHookPayload = {
  user: { id: string; phone?: string };
  sms: { otp: string };
};

/**
 * Проверка подписи по спецификации Standard Webhooks — та же схема,
 * что Supabase использует для всех своих HTTPS Auth Hooks (Send Email,
 * Send SMS, MFA verification). ВАЖНО: тело запроса читается как сырой
 * текст (request.text()), не парсится в JSON заранее — подпись
 * считается по точным байтам, и повторная сериализация после
 * JSON.parse её сломает.
 */
async function verifySignedPayload(request: Request): Promise<SendSmsHookPayload> {
  const hookSecret = process.env.SEND_SMS_HOOK_SECRET;
  if (!hookSecret) {
    throw new Error("SEND_SMS_HOOK_SECRET не задан в переменных окружения");
  }

  const payload = await request.text();
  const headers = Object.fromEntries(request.headers);

  // Секрет в Supabase Dashboard выдаётся в виде "v1,whsec_XXXX" —
  // библиотека ожидает только сам base64-секрет, префикс отрезаем.
  const wh = new Webhook(hookSecret.replace("v1,whsec_", ""));

  return wh.verify(payload, headers) as SendSmsHookPayload;
}

async function sendSmsViaSmsRu(phone: string, otp: string): Promise<void> {
  const apiId = process.env.SMSRU_API_ID;
  if (!apiId) {
    throw new Error("SMSRU_API_ID не задан в переменных окружения");
  }

  // SMS.ru принимает номер без "+" — см. https://sms.ru/api/send
  const normalizedPhone = phone.replace(/\D/g, "");
  const message = `Floria: ваш код входа — ${otp}`;

  const url = new URL("https://sms.ru/sms/send");
  url.searchParams.set("api_id", apiId);
  url.searchParams.set("to", normalizedPhone);
  url.searchParams.set("msg", message);
  url.searchParams.set("json", "1");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`SMS.ru HTTP ${response.status}`);
  }

  const result = (await response.json()) as {
    status: string;
    status_text?: string;
    sms?: Record<string, { status: string; status_text?: string }>;
  };

  if (result.status !== "OK") {
    throw new Error(`SMS.ru: ${result.status_text ?? result.status}`);
  }

  const perRecipientStatus = result.sms?.[normalizedPhone];
  if (perRecipientStatus && perRecipientStatus.status !== "OK") {
    throw new Error(`SMS.ru доставка: ${perRecipientStatus.status_text ?? perRecipientStatus.status}`);
  }
}

export async function POST(request: Request) {
  let payload: SendSmsHookPayload;

  try {
    payload = await verifySignedPayload(request);
  } catch (error) {
    console.error("Send SMS Hook: подпись не прошла проверку:", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;

  if (!phone || !otp) {
    // Сам payload не логируем: в нём лежит sms.otp — действующий код
    // входа. Достаточно знать, ЧЕГО не хватило.
    console.error(
      `Send SMS Hook: в payload нет ${!phone ? "телефона" : ""}${!phone && !otp ? " и " : ""}${!otp ? "OTP" : ""}`
    );
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const sentViaTelegram = await trySendOtpViaTelegram(phone, otp);

  if (!sentViaTelegram) {
    try {
      await sendSmsViaSmsRu(phone, otp);
    } catch (error) {
      console.error("Не удалось отправить SMS через SMS.ru:", error);
      // Возвращаем ошибку намеренно — если промолчать 200-кой, Supabase
      // решит, что код успешно доставлен, а человек его так и не получит.
      return NextResponse.json({ error: "Не удалось отправить SMS" }, { status: 500 });
    }
  }

  // Документация Supabase утверждает, что пустого 200 достаточно, но на
  // практике их auth-сервис реально отвечает "400: Invalid Content-Type:
  // Missing Content-Type header" на ответ без заголовка — обнаружено
  // 2026-08-21 при первом реальном тесте (раньше хук вообще не был
  // настроен на этот адрес, поэтому баг не проявлялся). NextResponse.json
  // сам проставляет Content-Type: application/json.
  return NextResponse.json({});
}
