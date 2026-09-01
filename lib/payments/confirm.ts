import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyStaffTelegram } from "@/lib/n8n";
import { escapeTelegramHtml } from "@/lib/telegram/bot";
import { notifyCustomerAboutStatus } from "@/lib/telegram/order-notify";

// ================================================================
// Перевод заказа в «оплачен» — единственное место, где это происходит.
//
// Сюда приходят два пути: уведомление от шлюза и сверка по расписанию.
// Оба уже СПРОСИЛИ у ВТБ настоящий статус, поэтому здесь мы не решаем,
// оплачено ли, а фиксируем факт. Но две проверки всё же делаем.
//
// 1. Идемпотентность. Уведомление может прийти дважды, а следом ещё и
//    сверка. Флориста не должно дёргать трижды за один заказ, поэтому
//    обновляем строку только пока она в pending и по результату обновления
//    решаем, слать ли уведомления.
//
// 2. Сверка суммы. Шлюз говорит, СКОЛЬКО получено. Если это не совпадает с
//    суммой заказа, заказ НЕ считается оплаченным: расхождение означает
//    либо ошибку на нашей стороне, либо попытку оплатить рубль вместо
//    пяти тысяч. Такое надо разбирать руками, а не пропускать молча.
// ================================================================

/** На сколько рублей допускаем расхождение — на округления, не более. */
const AMOUNT_TOLERANCE = 0.01;

export async function confirmPaidOrder(orderNumber: string, paidAmount: number): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, customer_name, customer_phone, total_amount, payment_status, delivery_date, is_pickup, staff_notify_details"
    )
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (error) throw new Error(`выборка заказа ${orderNumber}: ${error.message}`);

  if (!order) {
    // Заказа с таким номером у нас нет. Само по себе это подозрительно —
    // либо чужое уведомление, либо мы потеряли заказ. Разбираться руками.
    console.error(`[confirmPaidOrder] заказ ${orderNumber} не найден в базе`);
    return;
  }

  if (order.payment_status === "paid") {
    // Повторное уведомление — обычное дело, молча выходим.
    return;
  }

  const expected = Number(order.total_amount);
  if (Math.abs(expected - paidAmount) > AMOUNT_TOLERANCE) {
    console.error(
      `[confirmPaidOrder] заказ ${orderNumber}: сумма не сходится — ждали ${expected} ₽, ` +
        `шлюз сообщает ${paidAmount} ₽. НЕ подтверждаю оплату.`
    );
    await notifyStaffTelegram(
      `🚨 <b>Расхождение по оплате, заказ ${escapeTelegramHtml(orderNumber)}</b>\n\n` +
        `Сумма заказа: ${expected} ₽\n` +
        `Оплачено по данным банка: ${paidAmount} ₽\n\n` +
        `Заказ НЕ отмечен оплаченным. Нужно разобраться вручную.`
    );
    return;
  }

  const now = new Date().toISOString();

  // Условие payment_status = pending в самом UPDATE — защита от гонки:
  // уведомление и сверка могут прийти одновременно, и без него оба сочли бы
  // себя первыми и дважды дёрнули флориста.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("orders")
    .update({ payment_status: "paid", paid_at: now, payment_checked_at: now })
    .eq("id", order.id)
    .eq("payment_status", "pending")
    .select("id");

  if (updateError) throw new Error(`отметка оплаты ${orderNumber}: ${updateError.message}`);
  if (!updated || updated.length === 0) return; // кто-то успел раньше

  // ================================================================
  // Только теперь сообщаем студии. До оплаты заказ существует, виден в
  // админке, но работы не создаёт: при обязательной онлайн-оплате
  // недооплаченный заказ — это брошенная корзина, а не задача флористу.
  // ================================================================
  // Подробности заготовлены при оформлении (orders.staff_notify_details):
  // состав, адрес, открытка, комментарий курьеру. Если их почему-то нет —
  // шлём хотя бы шапку, отправить меньше лучше, чем не отправить ничего.
  const details = order.staff_notify_details
    ? `\n${order.staff_notify_details}`
    : "\nСостав и адрес — в админке.";

  const staffNotified = await notifyStaffTelegram(
    `💰 <b>ОПЛАЧЕН заказ ${escapeTelegramHtml(order.order_number)}</b>\n\n` +
      `Клиент: ${escapeTelegramHtml(order.customer_name ?? "—")}, ` +
      `${escapeTelegramHtml(order.customer_phone ?? "—")}\n` +
      details +
      `\nСумма: ${expected} ₽ — <b>оплачено онлайн</b>`
  );

  if (staffNotified) {
    await supabaseAdmin.from("orders").update({ staff_notified_at: now }).eq("id", order.id);
  } else {
    console.error(`[confirmPaidOrder] заказ ${orderNumber} оплачен, но студии не сообщили`);
  }

  // Клиенту — что оплата прошла и заказ взят в работу.
  await notifyCustomerAboutStatus(order.id, "confirmed");
}
