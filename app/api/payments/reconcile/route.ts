import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getPaymentOrder, PAID_STATUSES, DEAD_STATUSES } from "@/lib/payments/vtb";
import { confirmPaidOrder } from "@/lib/payments/confirm";
import { reportHealth } from "@/lib/health-report";

export const runtime = "nodejs";

// ================================================================
// Сверка платежей: спрашиваем у ВТБ сами, не дожидаясь уведомлений.
//
// Уведомления шлюза — не гарантия. Они могут не дойти (сеть, сбой у банка,
// наш перезапуск ровно в этот момент), а подписи у них нет, так что и
// пришедшему верить нельзя. Единственный надёжный способ узнать, оплачен
// ли заказ, — спросить у шлюза своими ключами. Здесь мы это и делаем,
// регулярно и для всех незакрытых платежей.
//
// Цена ошибки несимметрична: не заметить оплату — значит не собрать букет
// человеку, который заплатил. Поэтому сверка идёт часто, а не раз в сутки.
//
// Берём только заказы, по которым платёж РЕАЛЬНО заводился в ВТБ
// (payment_provider_id заполнен). Иначе сюда попали бы старые заказы,
// созданные до появления онлайн-оплаты: они тоже в статусе pending, но в
// шлюзе их нет, и каждый прогон давал бы ошибку на пустом месте.
// ================================================================

const BATCH = 20;

// Дальше этого срока платёж уже неинтересен: ссылка давно истекла, а заказ
// либо оплатили другим способом, либо он умер. Сверять их вечно — впустую
// дёргать банк.
const MAX_AGE_DAYS = 7;

function isValidSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expectedSecret = process.env.REMINDERS_CRON_SECRET;
  if (!expectedSecret) {
    console.error("[payments/reconcile] REMINDERS_CRON_SECRET не задан");
    return NextResponse.json({ error: "Задача не настроена" }, { status: 500 });
  }
  if (!isValidSecret(request.headers.get("x-cron-secret"), expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const since = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let confirmed = 0;
  let closed = 0;
  let stillPending = 0;
  const failures: string[] = [];

  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, payment_expires_at")
      .eq("payment_status", "pending")
      .not("payment_provider_id", "is", null)
      .gt("created_at", since)
      .order("payment_checked_at", { ascending: true, nullsFirst: true })
      .limit(BATCH);

    if (error) throw new Error(`выборка заказов: ${error.message}`);

    for (const order of data ?? []) {
      const now = new Date().toISOString();
      try {
        const state = await getPaymentOrder(order.order_number);

        if (PAID_STATUSES.has(state.status)) {
          await confirmPaidOrder(order.order_number, state.amount);
          confirmed += 1;
          continue;
        }

        if (DEAD_STATUSES.has(state.status)) {
          // Ссылка истекла или заказ отменён в шлюзе. Отмечаем, чтобы не
          // сверять его снова: оплата по нему уже не придёт. Сам заказ
          // остаётся в базе — клиент может начать оплату заново.
          await supabaseAdmin
            .from("orders")
            .update({ payment_status: "failed", payment_checked_at: now })
            .eq("id", order.id)
            .eq("payment_status", "pending");
          closed += 1;
          continue;
        }

        await supabaseAdmin.from("orders").update({ payment_checked_at: now }).eq("id", order.id);
        stillPending += 1;
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        failures.push(`${order.order_number}: ${text.slice(0, 120)}`);
        // Отметку времени ставим всё равно — иначе один вечно падающий
        // заказ занимал бы всю выборку и заслонял остальные.
        await supabaseAdmin.from("orders").update({ payment_checked_at: now }).eq("id", order.id);
      }
    }

    await reportHealth({
      key: "payments-reconcile",
      title: "Сверка платежей с банком",
      ok: failures.length === 0,
      errorText: failures.join("; "),
      // Порог 3: разовая недоступность банка — обычное дело, а вот час
      // подряд означает, что оплаты могут теряться незамеченными.
      failThreshold: 3,
    });

    return NextResponse.json({
      ok: true,
      подтвержденоОплат: confirmed,
      закрытоПросроченных: closed,
      ещёЖдут: stillPending,
      ошибок: failures.length,
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error("[payments/reconcile]", text);
    await reportHealth({
      key: "payments-reconcile",
      title: "Сверка платежей с банком",
      ok: false,
      errorText: text,
      failThreshold: 3,
    });
    return NextResponse.json({ error: text }, { status: 500 });
  }
}
