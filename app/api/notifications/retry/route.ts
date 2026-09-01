import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyStaffTelegram } from "@/lib/n8n";
import { escapeTelegramHtml } from "@/lib/telegram/bot";
import { reportHealth } from "@/lib/health-report";

export const runtime = "nodejs";

// ================================================================
// Добор непрошедших уведомлений.
//
// Заказ и обращение из формы теперь СНАЧАЛА пишутся в базу и только
// потом уходят в Telegram. Если отправка не удалась, строка остаётся с
// пустым staff_notified_at — то есть «студия про это не знает». Здесь мы
// такие строки находим и досылаем.
//
// Про честность тревоги. Сообщить «Telegram не работает» через Telegram
// нельзя — канал ровно тот же, что сломался. Поэтому задача не полагается
// на уведомление как на единственный выход:
//   - повторяет попытки, так что разовый сбой сети лечится сам;
//   - оставляет состояние в базе, и /admin показывает его глазами;
//   - когда связь вернётся, reportHealth пришлёт сообщение о том, что
//     всё это время было сломано (в этот момент оно уже дойдёт).
//
// Из-за этого порог тревоги здесь 1, а не 3, как у синхронизации
// каталога: неотправленный заказ — это ждущий клиент и потерянные
// деньги, тут терпеть нечего.
// ================================================================

// Заказу дают доспать минуту: строка появляется чуть раньше, чем
// завершается отправка в исходном запросе, и без этой форточки задача
// хватала бы заказ, который прямо сейчас успешно уходит.
const GRACE_MS = 60 * 1000;

// Сколько строк берём за прогон — чтобы после долгой недоступности
// Telegram не отправить триста сообщений подряд и не поймать его лимиты.
const BATCH = 20;

function isValidSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

type Outcome = { resent: number; stillFailing: number };

async function retryOrders(cutoff: string): Promise<Outcome> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, customer_name, customer_phone, delivery_date, total_amount, is_pickup")
    .is("staff_notified_at", null)
    // Только оплаченные: при обязательной онлайн-оплате неоплаченный заказ —
    // брошенная корзина, и досылать о ней уведомления значит спамить студию
    // каждой недодуманной покупкой.
    .eq("payment_status", "paid")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(`выборка заказов: ${error.message}`);

  let resent = 0;
  let stillFailing = 0;

  for (const order of data ?? []) {
    const ok = await notifyStaffTelegram(
      `⚠️ <b>Заказ ${escapeTelegramHtml(order.order_number)} — сообщаем с опозданием</b>\n\n` +
        `О нём не удалось сообщить сразу при оформлении.\n\n` +
        `Клиент: ${escapeTelegramHtml(order.customer_name ?? "—")}, ${escapeTelegramHtml(order.customer_phone ?? "—")}\n` +
        `${order.is_pickup ? "🏪 Самовывоз" : "🚚 Доставка"}: ${escapeTelegramHtml(String(order.delivery_date ?? "—"))}\n` +
        `Сумма: ${order.total_amount} ₽\n\n` +
        `Полный состав — в админке.`
    );

    if (ok) {
      await supabaseAdmin
        .from("orders")
        .update({ staff_notified_at: new Date().toISOString() })
        .eq("id", order.id);
      resent += 1;
    } else {
      stillFailing += 1;
    }
  }

  return { resent, stillFailing };
}

async function retryContacts(cutoff: string): Promise<Outcome> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("contact_requests")
    .select("id, name, phone, message, notify_attempts")
    .is("staff_notified_at", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(`выборка обращений: ${error.message}`);

  let resent = 0;
  let stillFailing = 0;

  for (const item of data ?? []) {
    const ok = await notifyStaffTelegram(
      `⚠️ <b>Заявка на обратный звонок — сообщаем с опозданием</b>\n\n` +
        `Имя: ${escapeTelegramHtml(item.name)}\n` +
        `Телефон: ${escapeTelegramHtml(item.phone)}\n` +
        `Сообщение: ${item.message ? escapeTelegramHtml(item.message) : "—"}`
    );

    const patch: Record<string, unknown> = { notify_attempts: (item.notify_attempts ?? 0) + 1 };
    if (ok) {
      patch.staff_notified_at = new Date().toISOString();
      resent += 1;
    } else {
      stillFailing += 1;
    }
    await supabaseAdmin.from("contact_requests").update(patch).eq("id", item.id);
  }

  return { resent, stillFailing };
}

export async function POST(request: Request) {
  const expectedSecret = process.env.REMINDERS_CRON_SECRET;
  if (!expectedSecret) {
    console.error("[notifications/retry] REMINDERS_CRON_SECRET не задан");
    return NextResponse.json({ error: "Задача не настроена" }, { status: 500 });
  }

  if (!isValidSecret(request.headers.get("x-cron-secret"), expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - GRACE_MS).toISOString();

  try {
    const orders = await retryOrders(cutoff);
    const contacts = await retryContacts(cutoff);
    const stillFailing = orders.stillFailing + contacts.stillFailing;

    await reportHealth({
      key: "staff-notify",
      title: "Уведомления студии о заказах",
      ok: stillFailing === 0,
      errorText:
        stillFailing > 0
          ? `Не удалось сообщить о ${stillFailing} записях (заказов: ${orders.stillFailing}, заявок: ${contacts.stillFailing}). ` +
            `Они видны в админке и будут досылаться дальше.`
          : undefined,
      failThreshold: 1,
    });

    return NextResponse.json({
      ok: true,
      досланоЗаказов: orders.resent,
      досланоЗаявок: contacts.resent,
      осталосьНедоставленных: stillFailing,
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error("[notifications/retry]", text);
    await reportHealth({
      key: "staff-notify",
      title: "Уведомления студии о заказах",
      ok: false,
      errorText: text,
      failThreshold: 1,
    });
    return NextResponse.json({ error: text }, { status: 500 });
  }
}
