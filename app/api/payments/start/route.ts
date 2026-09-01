import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createPaymentOrder } from "@/lib/payments/vtb";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { CONTACTS } from "@/lib/contacts";

export const runtime = "nodejs";

// ================================================================
// Создание платежа по уже существующему заказу.
//
// Почему это отдельный запрос, а не часть оформления. Если создавать
// платёж внутри /api/orders, то недоступность банка означала бы провал
// всего оформления: человек заполнил форму, а в ответ — ошибка и пустота.
// Разделив, мы получаем заказ в базе при любом раскладе, а оплату можно
// повторить — из личного кабинета или по ссылке, не заполняя всё заново.
//
// Идентификатор заказа здесь — UUID, а не человекочитаемый номер: номера
// предсказуемы, и по ним можно было бы перебором проверять чужие заказы.
// UUID не подберёшь, а больше эта ручка ничего и не отдаёт: она лишь
// создаёт ссылку на оплату этого заказа. Оплатить чужой заказ вреда не
// причиняет — деньги уйдут за него же.
// ================================================================

const START_LIMIT = 10;
const START_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  const limit = rateLimit(`pay-start:${clientIp(request)}`, START_LIMIT, START_WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  let body: { orderId?: string };
  try {
    body = (await request.json()) as { orderId?: string };
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const orderId = body.orderId?.trim();
  if (!orderId) return NextResponse.json({ error: "Не указан заказ" }, { status: 400 });

  const supabaseAdmin = getSupabaseAdmin();

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, total_amount, payment_status, payment_url, payment_expires_at, customer_email, customer_phone"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error("[payments/start] выборка заказа:", error.message);
    return NextResponse.json({ error: "Не удалось загрузить заказ" }, { status: 500 });
  }
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });

  if (order.payment_status === "paid") {
    return NextResponse.json({ error: "Заказ уже оплачен", alreadyPaid: true }, { status: 409 });
  }

  // Ссылка ещё жива — отдаём её же, а не плодим ордера в шлюзе. Минута
  // запаса, чтобы не выдать ссылку, которая протухнет по дороге.
  const existingExpiry = order.payment_expires_at ? new Date(order.payment_expires_at).getTime() : 0;
  if (order.payment_url && existingExpiry > Date.now() + 60_000) {
    return NextResponse.json({ paymentUrl: order.payment_url, expiresAt: order.payment_expires_at });
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from("order_items")
    .select("product_name, quantity, unit_price")
    .eq("order_id", order.id);

  if (itemsError) {
    console.error("[payments/start] выборка состава:", itemsError.message);
    return NextResponse.json({ error: "Не удалось загрузить состав заказа" }, { status: 500 });
  }

  try {
    const result = await createPaymentOrder({
      orderId: order.order_number,
      orderName: `Floria, заказ ${order.order_number}`,
      amount: Number(order.total_amount),
      customerEmail: order.customer_email ?? null,
      customerPhone: order.customer_phone ?? "",
      returnUrl: `${CONTACTS.siteUrl}/orders/${order.id}/payment-return`,
      items: (items ?? []).map((i) => ({
        name: i.product_name as string,
        quantity: Number(i.quantity),
        price: Number(i.unit_price),
      })),
    });

    // sbpUrl приходит только если у ресурса подключена СБП. Пишем в лог:
    // это единственный надёжный способ узнать, доехала ли регистрация в
    // Системе быстрых платежей, — по документации об этом не судить.
    if (!result.sbpUrl) {
      console.warn(
        `[payments/start] заказ ${order.order_number}: шлюз не вернул ссылку СБП — ` +
          `похоже, СБП не подключена к ресурсу. Платёжная форма всё равно откроется.`
      );
    }

    await supabaseAdmin
      .from("orders")
      .update({
        payment_method: "sbp",
        payment_provider_id: result.orderCode,
        payment_url: result.payUrl,
        payment_expires_at: result.expire,
      })
      .eq("id", order.id);

    return NextResponse.json({
      paymentUrl: result.payUrl,
      sbpAvailable: Boolean(result.sbpUrl),
      expiresAt: result.expire,
    });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    console.error(`[payments/start] заказ ${order.order_number}:`, text);
    return NextResponse.json(
      { error: "Не получилось создать оплату. Попробуйте ещё раз или позвоните нам." },
      { status: 502 }
    );
  }
}
