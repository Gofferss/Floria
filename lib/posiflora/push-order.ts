import { posifloraFetch } from "@/lib/posiflora/http";
import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Отправка заказа с сайта в Posiflora.
//
// Зачем. Раньше флорист перенабирал заказ руками: открывал Telegram,
// читал адрес, время, состав — и вбивал всё заново в кассу. Двойной ввод
// это не только время, но и опечатки в адресе, по которому поедет курьер.
//
// Чего сделать НЕЛЬЗЯ, и это ограничение Posiflora, а не наше: привязать
// состав букета позициями. У букета в их модели нет связи с заказом, у
// заказа нет связи с букетами — проверено и по их спецификации, и по
// живым данным. Поэтому состав кладём текстом в description: флорист
// увидит, что собирать, и соберёт букет у себя как обычно.
//
// Когда отправляем. После подтверждения оплаты, а не при оформлении.
// Неоплаченный заказ — это брошенная корзина, и в кассе ей не место:
// она попадёт в отчёты и испортит выручку.
//
// Если Posiflora недоступна (а она ломается — их /categories отдаёт 500
// неделями), заказ всё равно остаётся подтверждённым у нас. Отправку
// повторит фоновая задача: признак «не отправлен» — пустой
// orders.posiflora_order_id.
// ================================================================

/** Точка продаж «Флория» — склад (второй store) для заказов не используется. */
const STORE_ID = "5be91e82-40fd-4a86-9ea0-67aa17be54f0";

/** Источник заказа «Сайт» — заведён в Posiflora, отличает нас от продаж за прилавком. */
const SOURCE_SITE_ID = "f128f295-5f2a-41b5-b63d-e6e1d6dbd4d5";

type OrderForPush = {
  id: string;
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  delivery_date: string | null;
  delivery_time_from: string | null;
  delivery_time_to: string | null;
  delivery_city: string | null;
  delivery_address: string | null;
  delivery_apartment: string | null;
  courier_comment: string | null;
  card_text: string | null;
  is_pickup: boolean | null;
  total_amount: number | string | null;
};

/** Телефон для Posiflora — только цифры. */
function digits(phone: string | null): string {
  return (phone ?? "").replace(/\D/g, "");
}

/**
 * Всё, что флорист должен прочитать глазами: состав, открытка, пожелания
 * курьеру. Состав сюда попадает ТЕКСТОМ, потому что позициями его не
 * привязать (см. заголовок файла).
 */
function buildDescription(order: OrderForPush, items: { product_name: string; quantity: number }[]): string {
  const lines: string[] = [`Заказ с сайта ${order.order_number}`];

  if (items.length) {
    lines.push("", "Состав:");
    items.forEach((i) => lines.push(`• ${i.product_name} × ${i.quantity}`));
  }

  if (order.card_text?.trim()) {
    lines.push("", `Открытка: ${order.card_text.trim()}`);
  }
  if (order.courier_comment?.trim()) {
    lines.push("", `Курьеру: ${order.courier_comment.trim()}`);
  }
  if (order.is_pickup) {
    lines.push("", "САМОВЫВОЗ — клиент заберёт из студии");
  }

  lines.push("", "Оплачено онлайн.");
  return lines.join("\n").slice(0, 2000);
}

/**
 * Создаёт заказ в Posiflora. Возвращает её идентификатор заказа или null,
 * если отправить не удалось — вызывающий код решает, что с этим делать.
 * Исключения наружу НЕ бросаем: сбой кассы не должен ломать подтверждение
 * оплаты, деньги уже приняты.
 */
export async function pushOrderToPosiflora(orderId: string): Promise<string | null> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, customer_name, customer_phone, recipient_name, recipient_phone, " +
        "delivery_date, delivery_time_from, delivery_time_to, delivery_city, delivery_address, " +
        "delivery_apartment, courier_comment, card_text, is_pickup, total_amount, posiflora_order_id"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    console.error(`[pushOrderToPosiflora] заказ ${orderId}: не нашёлся — ${error?.message ?? "нет строки"}`);
    return null;
  }

  const typed = order as unknown as OrderForPush & { posiflora_order_id: string | null };

  // Уже отправляли — второй раз не создаём: в кассе появился бы дубль,
  // и выручка посчиталась бы дважды.
  if (typed.posiflora_order_id) return typed.posiflora_order_id;

  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("product_name, quantity")
    .eq("order_id", orderId);

  const address = [typed.delivery_city, typed.delivery_address, typed.delivery_apartment]
    .filter((p) => p && String(p).trim())
    .join(", ");

  const attributes: Record<string, unknown> = {
    // Номер документа берём свой: подстраиваться под их нумерацию значило бы
    // угадывать следующий номер и однажды столкнуться с кассиром.
    docNo: typed.order_number,
    date: new Date().toISOString(),
    description: buildDescription(typed, items ?? []),
    totalAmount: Number(typed.total_amount ?? 0),
    budget: Number(typed.total_amount ?? 0),
    isExternal: true,
    externalId: typed.order_number,
    delivery: !typed.is_pickup,
  };

  if (!typed.is_pickup) {
    attributes.deliveryStreet = address || null;
    attributes.deliveryComments = typed.courier_comment ?? null;
    attributes.deliveryContact = typed.recipient_name ?? typed.customer_name ?? null;
    attributes.deliveryPhoneNumber = digits(typed.recipient_phone ?? typed.customer_phone);
    if (typed.delivery_time_from) attributes.deliveryTimeFrom = typed.delivery_time_from;
    if (typed.delivery_time_to) attributes.deliveryTimeTo = typed.delivery_time_to;
  }

  if (typed.delivery_date) attributes.dueTime = typed.delivery_date;

  try {
    const created = (await posifloraFetch("/orders", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "orders",
          attributes,
          relationships: {
            store: { data: { type: "stores", id: STORE_ID } },
            source: { data: { type: "order-sources", id: SOURCE_SITE_ID } },
          },
        },
      }),
    })) as { data?: { id?: string } };

    const posifloraId = created?.data?.id;
    if (!posifloraId) {
      console.error(`[pushOrderToPosiflora] заказ ${typed.order_number}: ответ без идентификатора`);
      return null;
    }

    await supabaseAdmin
      .from("orders")
      .update({ posiflora_order_id: posifloraId })
      .eq("id", orderId);

    return posifloraId;
  } catch (err) {
    console.error(
      `[pushOrderToPosiflora] заказ ${typed.order_number}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
