import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getPaymentOrder, PAID_STATUSES } from "@/lib/payments/vtb";
import { confirmPaidOrder } from "@/lib/payments/confirm";

export const runtime = "nodejs";

// ================================================================
// Уведомление от платёжного шлюза ВТБ.
//
// ГЛАВНОЕ: содержимому этого запроса верить нельзя.
//
// Уведомления ВТБ не подписаны — ни HMAC, ни контрольной суммы, ни белого
// списка адресов в их инструкции нет (проверено по всему документу). Значит
// прислать сюда «заказ оплачен» может кто угодно, кто узнал адрес. Если бы
// мы верили телу запроса, это была бы дыра ровно того же рода, что и
// возможность переписать себе бонусы: бесплатные цветы по HTTP-запросу.
//
// Поэтому уведомление здесь работает как звонок в дверь, а не как документ:
// из него берётся ТОЛЬКО идентификатор заказа, а правду мы спрашиваем сами —
// запросом getPaymentOrder() к ВТБ со своими ключами. Подделать это нельзя,
// не имея наших ключей.
//
// Побочная выгода: если уведомление вовсе не дойдёт (сеть, сбой у банка),
// заказ не зависнет — та же проверка выполняется по расписанию, см.
// app/api/payments/reconcile.
//
// Отвечаем 200 почти всегда: для шлюза наш ответ означает «сообщение
// принято», и заставлять его повторять попытки из-за наших внутренних
// проблем незачем — сверка всё равно догонит.
// ================================================================

type VtbCallback = {
  type?: string;
  object?: {
    orderId?: string;
    // В примере из инструкции поле названо "Status" с большой буквы, в
    // остальных ответах — "status". Обрабатываем оба: цена ошибки здесь
    // выше, чем цена лишней строки.
    status?: { value?: string };
    Status?: { value?: string };
  };
};

export async function POST(request: Request) {
  let payload: VtbCallback;

  try {
    payload = (await request.json()) as VtbCallback;
  } catch {
    console.error("[vtb-callback] тело запроса не JSON");
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const orderId = payload.object?.orderId;
  if (!orderId) {
    console.error("[vtb-callback] в уведомлении нет orderId:", JSON.stringify(payload).slice(0, 300));
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Статус из уведомления только логируем — решение принимаем не по нему.
  const claimed = payload.object?.status?.value ?? payload.object?.Status?.value ?? "?";
  console.log(`[vtb-callback] заказ ${orderId}: шлюз сообщает "${claimed}", проверяем сами`);

  try {
    const state = await getPaymentOrder(orderId);

    if (!PAID_STATUSES.has(state.status)) {
      // Не оплачено — это нормальная ветка, а не ошибка: уведомления
      // приходят и на промежуточные события.
      console.log(`[vtb-callback] заказ ${orderId}: по данным ВТБ статус ${state.status}, не оплачен`);
      await getSupabaseAdmin()
        .from("orders")
        .update({ payment_checked_at: new Date().toISOString() })
        .eq("order_number", orderId);
      return NextResponse.json({ received: true }, { status: 200 });
    }

    await confirmPaidOrder(orderId, state.amount);
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error(`[vtb-callback] заказ ${orderId}: не удалось проверить статус:`, text);
    // 200 намеренно: пусть шлюз считает уведомление доставленным. Заказ
    // останется в pending, и сверка по расписанию разберётся сама.
    return NextResponse.json({ received: true }, { status: 200 });
  }
}
