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
//
// Форматы полей сняты с живых данных кассы и проверены пробным заказом,
// а не угаданы:
//   date             — «2026-08-10», БЕЗ времени (полный ISO даёт 400)
//   dueTime, delivery
//   TimeFrom/TimeTo  — полная метка времени
//   totalAmount      — ТОЛЬКО ЧТЕНИЕ. Касса считает его по позициям; PATCH
//                      проходит с кодом 200 и ничего не меняет. Позиции же
//                      через API не привязать. Поэтому сумма у заказа с
//                      сайта в кассе остаётся нулём, и настоящая сумма
//                      едет в budget и текстом в description.
//   paymentsAmount   — тоже остаётся нулём: оплата живёт отдельным
//                      ресурсом /payments, привязанным к смене и фискальному
//                      регистратору. Мы его не трогаем, поэтому в описании
//                      прямо предупреждаем кассира не брать деньги повторно.
//
// Про часовой пояс. Касса ОТБРАСЫВАЕТ присланное смещение: на «14:00+03:00»
// она сохраняет «14:00+00:00». Значит в эти поля едет местное время студии,
// помеченное нулевым смещением — что пошлём, то и сохранится.
//
// Про статус, и это главное. Заказ, созданный извне, касса по умолчанию
// кладёт в статус «не принят» (notAccepted). В студии в этот список не
// смотрит никто: до нашего первого пробного заказа счётчик там стоял на
// нуле за всю историю. То есть оплаченный заказ доехал бы до кассы и остался
// невидимым — ровно тот сорт тихой потери, из-за которого здесь уже горело.
// Поэтому заказ сразу ставится в рабочую очередь «новый», и результат
// перечитывается: касса умеет отвечать «200 OK», ничего не изменив.
// ================================================================

/** Точка продаж «Флория» — склад (второй store) для заказов не используется. */
const STORE_ID = "5be91e82-40fd-4a86-9ea0-67aa17be54f0";

/** Источник заказа «Сайт» — заведён в Posiflora, отличает нас от продаж за прилавком. */
const SOURCE_SITE_ID = "f128f295-5f2a-41b5-b63d-e6e1d6dbd4d5";

/** Рабочая очередь флориста. Не «не принят», куда касса кладёт внешние заказы сама. */
const WORK_QUEUE_STATUS = "new";

/** Крым круглый год на UTC+3: переходов на летнее время в России нет. */
const STUDIO_TZ = "Europe/Simferopol";

/**
 * Нулевое смещение здесь не ошибка: касса отбрасывает присланное смещение и
 * сохраняет сами цифры (проверено пробным заказом). Поэтому мы кладём в эти
 * поля местное время студии и помечаем его так же, как помечает сама касса.
 */
const STUDIO_OFFSET = "+00:00";

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
  delivery_entrance: string | null;
  delivery_floor: string | null;
  delivery_apartment: string | null;
  delivery_intercom_code: string | null;
  courier_comment: string | null;
  card_text: string | null;
  is_pickup: boolean | null;
  total_amount: number | string | null;
};

/** Сегодняшняя дата по студии, а не по UTC: заказ в час ночи иначе уехал бы на вчера. */
function todayAtStudio(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_TZ }).format(new Date());
}

/** Дата «2026-10-20» и время «14:00:00» — в метку времени, которую ждёт касса. */
function studioInstant(date: string, time: string | null): string {
  const t = (time ?? "00:00:00").slice(0, 8);
  return `${date}T${t.length === 5 ? `${t}:00` : t}${STUDIO_OFFSET}`;
}

/**
 * Телефон разбиваем на код страны и номер — в кассе это отдельные поля.
 * Российский номер в любом виде (+7, 8, без кода) приводим к «7» + 10 цифр.
 */
function splitPhone(phone: string | null): { code: string; number: string } {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && (d.startsWith("7") || d.startsWith("8"))) {
    return { code: "7", number: d.slice(1) };
  }
  if (d.length === 10) return { code: "7", number: d };
  return { code: "", number: d };
}

/**
 * Всё, что флорист должен прочитать глазами: состав, открытка, пожелания
 * курьеру. Состав сюда попадает ТЕКСТОМ, потому что позициями его не
 * привязать (см. заголовок файла).
 */
function buildDescription(order: OrderForPush, items: { product_name: string; quantity: number }[]): string {
  const amount = Number(order.total_amount ?? 0);

  // Сумма идёт ТЕКСТОМ, и это не дублирование: поле totalAmount касса
  // считает сама по позициям, а позиции через API не привязать — у заказа
  // с сайта сумма в кассе так и останется нулём. Если не написать её здесь,
  // флорист увидит заказ «за 0 ₽» и может собрать букет не того уровня.
  // Вторая половина строки — защита от повторного списания: оплату касса
  // тоже не видит (paymentsAmount = 0), и без предупреждения кассир
  // способен взять деньги с уже заплатившего клиента.
  const lines: string[] = [
    `Заказ с сайта ${order.order_number}`,
    `ОПЛАЧЕНО ОНЛАЙН: ${amount} ₽ — повторно деньги не брать`,
  ];

  if (items.length) {
    lines.push("", "Состав:");
    items.forEach((i) => lines.push(`• ${i.product_name} × ${i.quantity}`));
  }

  if (order.card_text?.trim()) {
    lines.push("", `Открытка: ${order.card_text.trim()}`);
  }
  if (order.is_pickup) {
    lines.push("", "САМОВЫВОЗ — клиент заберёт из студии");
  }

  return lines.join("\n").slice(0, 2000);
}

/**
 * Подъезд, этаж и код домофона собственных полей в кассе не имеют. Молча их
 * потерять нельзя — без кода домофона курьер стоит у двери. Поэтому они
 * едут в комментарий к доставке вместе с пожеланиями клиента.
 */
function buildDeliveryComments(order: OrderForPush): string {
  const parts: string[] = [];
  if (order.delivery_entrance?.trim()) parts.push(`подъезд ${order.delivery_entrance.trim()}`);
  if (order.delivery_floor?.trim()) parts.push(`этаж ${order.delivery_floor.trim()}`);
  if (order.delivery_intercom_code?.trim()) parts.push(`домофон ${order.delivery_intercom_code.trim()}`);
  if (order.courier_comment?.trim()) parts.push(order.courier_comment.trim());
  return parts.join(", ").slice(0, 500);
}

/**
 * Переставляет заказ в рабочую очередь, если касса не приняла статус сразу.
 *
 * Отдельной функцией, потому что проверка тут важнее самой правки: эта касса
 * умеет отвечать «200 OK» и не менять ничего (так ведёт себя totalAmount).
 * Поэтому мало отправить — надо перечитать и убедиться.
 */
async function ensureInWorkQueue(posifloraId: string, orderNumber: string, statusAfterCreate: unknown): Promise<void> {
  if (statusAfterCreate === WORK_QUEUE_STATUS) return;

  try {
    const patched = (await posifloraFetch(`/orders/${posifloraId}`, {
      method: "PATCH",
      body: JSON.stringify({
        data: { type: "orders", id: posifloraId, attributes: { status: WORK_QUEUE_STATUS } },
      }),
    })) as { data?: { attributes?: { status?: string } } };

    if (patched?.data?.attributes?.status === WORK_QUEUE_STATUS) return;

    console.error(
      `[pushOrderToPosiflora] заказ ${orderNumber}: касса оставила статус ` +
        `«${patched?.data?.attributes?.status ?? "неизвестно"}» вместо «${WORK_QUEUE_STATUS}». ` +
        `В кассе он лежит в «не принятых» — там его не ищут. Состав и адрес у студии есть в Telegram.`
    );
  } catch (err) {
    console.error(
      `[pushOrderToPosiflora] заказ ${orderNumber}: не удалось поставить в работу —`,
      err instanceof Error ? err.message : String(err)
    );
  }
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
        "delivery_entrance, delivery_floor, delivery_apartment, delivery_intercom_code, " +
        "courier_comment, card_text, is_pickup, total_amount, posiflora_order_id"
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

  const attributes: Record<string, unknown> = {
    // Номер документа берём свой: подстраиваться под их нумерацию значило бы
    // угадывать следующий номер и однажды столкнуться с кассиром.
    docNo: typed.order_number,
    date: todayAtStudio(),
    description: buildDescription(typed, items ?? []),
    totalAmount: Number(typed.total_amount ?? 0),
    budget: Number(typed.total_amount ?? 0),
    isExternal: true,
    externalId: typed.order_number,
    delivery: !typed.is_pickup,
    status: WORK_QUEUE_STATUS,
  };

  if (!typed.is_pickup) {
    const phone = splitPhone(typed.recipient_phone ?? typed.customer_phone);
    attributes.deliveryCity = typed.delivery_city ?? "";
    attributes.deliveryStreet = typed.delivery_address ?? "";
    attributes.deliveryApartment = typed.delivery_apartment ?? "";
    attributes.deliveryComments = buildDeliveryComments(typed);
    attributes.deliveryContact = typed.recipient_name ?? typed.customer_name ?? "";
    attributes.deliveryPhoneCode = phone.code;
    attributes.deliveryPhoneNumber = phone.number;

    if (typed.delivery_date && typed.delivery_time_from) {
      attributes.deliveryTimeFrom = studioInstant(typed.delivery_date, typed.delivery_time_from);
    }
    if (typed.delivery_date && typed.delivery_time_to) {
      attributes.deliveryTimeTo = studioInstant(typed.delivery_date, typed.delivery_time_to);
    }
  }

  // Срок готовности — к началу интервала доставки, а при самовывозе к дате.
  if (typed.delivery_date) {
    attributes.dueTime = studioInstant(typed.delivery_date, typed.delivery_time_from);
  }

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
    })) as { data?: { id?: string; attributes?: { status?: string } } };

    const posifloraId = created?.data?.id;
    if (!posifloraId) {
      console.error(`[pushOrderToPosiflora] заказ ${typed.order_number}: ответ без идентификатора`);
      return null;
    }

    // Идентификатор запоминаем ДО возни со статусом: заказ в кассе уже есть,
    // и если дальше что-то сорвётся, повтор не должен создать второй.
    await supabaseAdmin
      .from("orders")
      .update({ posiflora_order_id: posifloraId })
      .eq("id", orderId);

    await ensureInWorkQueue(posifloraId, typed.order_number, created?.data?.attributes?.status);

    return posifloraId;
  } catch (err) {
    console.error(
      `[pushOrderToPosiflora] заказ ${typed.order_number}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
