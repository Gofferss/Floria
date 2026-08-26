import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createPosifloraOrder } from "@/lib/posiflora";
import { getProductBySlug } from "@/lib/products";
import { validatePromoCode, recordPromoCodeRedemption } from "@/lib/promo-codes";
import { resolveOrCreateCustomerByPhone, refreshCustomerBonusBalance } from "@/lib/customer-sync";
import { toE164RussianPhone } from "@/lib/phone-mask";
import { notifyN8n, notifyStaffTelegram } from "@/lib/n8n";
import { escapeTelegramHtml } from "@/lib/telegram/bot";
import { confirmOrderToCustomer } from "@/lib/telegram/order-notify";
import { createSupabaseServerClient } from "@/lib/auth/server";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import {
  TIME_SLOTS,
  calcDeliveryPrice,
  earliestDeliveryDate,
  MADE_TO_ORDER_LEAD_DAYS,
  SAME_DAY_CUTOFF_HOUR,
  type CheckoutPayload,
} from "@/lib/checkout";

// Используем service-role ключ Supabase и Node-совместимые API — нужен
// node-рантайм, не edge.
export const runtime = "nodejs";

/** Потолок количества одной позиции в заказе — см. проверку в validatePayload. */
const MAX_ITEM_QUANTITY = 500;

type ValidationResult =
  | { valid: true; data: CheckoutPayload }
  | { valid: false; error: string };

function validatePayload(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Некорректное тело запроса" };
  }

  const payload = body as Partial<CheckoutPayload>;

  if (!payload.customerName?.trim()) {
    return { valid: false, error: "Не указано имя заказчика" };
  }

  // Приводим к E.164 (+7XXXXXXXXXX) — тот же формат, в котором телефон
  // хранится в customers.phone у клиентов, вошедших по SMS. Без этого
  // resolveOrCreateCustomerByPhone ниже не находил бы существующую
  // карточку клиента из-за разного форматирования одного и того же номера.
  const normalizedCustomerPhone = payload.customerPhone
    ? toE164RussianPhone(payload.customerPhone)
    : null;
  if (!normalizedCustomerPhone) {
    return { valid: false, error: "Некорректный телефон заказчика" };
  }
  payload.customerPhone = normalizedCustomerPhone;

  if (!payload.isRecipientSelf) {
    if (!payload.recipientName?.trim()) {
      return { valid: false, error: "Не указано имя получателя" };
    }
    const normalizedRecipientPhone = payload.recipientPhone
      ? toE164RussianPhone(payload.recipientPhone)
      : null;
    if (!normalizedRecipientPhone) {
      return { valid: false, error: "Некорректный телефон получателя" };
    }
    payload.recipientPhone = normalizedRecipientPhone;
  }
  if (!payload.deliveryDate) {
    return { valid: false, error: "Не указана дата доставки" };
  }
  if (!payload.deliveryTimeSlot) {
    return { valid: false, error: "Не указано время доставки" };
  }
  if (!TIME_SLOTS.some((slot) => slot.id === payload.deliveryTimeSlot)) {
    return { valid: false, error: "Некорректный интервал доставки" };
  }
  // Самовывоз — адрес не нужен; для доставки он обязателен.
  payload.isPickup = payload.isPickup === true;
  if (!payload.isPickup && !payload.deliveryAddress?.trim()) {
    return { valid: false, error: "Не указан адрес доставки" };
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return { valid: false, error: "Корзина пуста" };
  }
  for (const item of payload.items) {
    if (
      !item ||
      typeof item.name !== "string" ||
      typeof item.price !== "number" ||
      typeof item.quantity !== "number" ||
      item.price < 0
    ) {
      return { valid: false, error: "Некорректный состав заказа" };
    }

    // Количество: целое и в разумных пределах.
    //
    // Раньше проверялось только «число и не меньше 1», поэтому проходили
    // и 1.5 штуки (итог считался с копейками, а собрать полтора букета
    // нельзя), и 999999 штук. Пока оплаты нет, это лишь мусорный заказ,
    // который флорист отменит вручную. С появлением оплаты цена ошибки
    // вырастет, поэтому закрываем заранее.
    //
    // Верхняя граница щедрая: поштучную срезку берут и по 101 цветку,
    // а вот 500 — это уже не розничный заказ, а опечатка или перебор.
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) {
      return {
        valid: false,
        error: `Количество должно быть целым числом от 1 до ${MAX_ITEM_QUANTITY}. Нужно больше — позвоните нам, оформим отдельно.`,
      };
    }
  }

  return { valid: true, data: payload as CheckoutPayload };
}

function generateOrderNumber(): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `FL-${time}${random}`;
}

// Каждый заказ — уведомление флористу и строка в БД. Живой клиент за час
// столько заказов не оформляет, а поток фальшивых способен похоронить
// настоящие среди уведомлений.
const ORDER_LIMIT = 10;
const ORDER_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const limit = rateLimit(`orders:${clientIp(request)}`, ORDER_LIMIT, ORDER_WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Невалидный JSON в теле запроса" }, { status: 400 });
  }

  const validation = validatePayload(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const payload = validation.data;

  // Название и цену каждой позиции пересчитываем на сервере по каталогу,
  // а не берём из тела запроса — иначе через devtools можно отправить
  // {price: 1} за настоящий товар и оформить заказ почти бесплатно.
  // Раньше здесь пересчитывалась только СУММА (payload.items.reduce),
  // но цену за штуку клиент по-прежнему присылал сам и она шла прямиком
  // в БД и в Posiflora без проверки.
  type ResolvedItem = { name: string; size: string; price: number; quantity: number };
  const resolvedItems: ResolvedItem[] = [];
  let hasMadeToOrder = false;
  for (const item of payload.items) {
    const product = item.productSlug ? await getProductBySlug(item.productSlug) : null;
    if (!product) {
      return NextResponse.json(
        { error: `Товар «${item.name}» больше недоступен — обновите корзину` },
        { status: 400 }
      );
    }
    if (product.availabilityMode === "made_to_order") hasMadeToOrder = true;
    const size = product.sizes.find((s) => s.label === item.size) ?? product.sizes[0];
    resolvedItems.push({
      name: product.name,
      size: size.label,
      price: product.basePrice + size.priceModifier,
      quantity: item.quantity,
    });
  }

  // Дату проверяем на сервере по тем же правилам, что показывает форма
  // (после 21:00 сегодня уже нельзя, «под заказ» — минимум через двое
  // суток). Признак «под заказ» берём из каталога, а не из тела запроса:
  // иначе срок можно было бы обойти, подменив его в devtools.
  const earliest = earliestDeliveryDate({ hasMadeToOrder });
  if (payload.deliveryDate < earliest) {
    return NextResponse.json(
      {
        error: hasMadeToOrder
          ? `Букет «под заказ» собирается минимум за ${MADE_TO_ORDER_LEAD_DAYS} дня — выберите дату с ${earliest}`
          : `Заказы на сегодня принимаем до ${SAME_DAY_CUTOFF_HOUR}:00 — выберите дату с ${earliest} или позвоните нам`,
      },
      { status: 400 }
    );
  }

  // Суммы пересчитываем на сервере — не доверяем итогам, посчитанным на
  // клиенте (клиент мог отправить что угодно).
  const itemsTotal = resolvedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryPrice = calcDeliveryPrice({
    isPickup: payload.isPickup,
    timeSlot: payload.deliveryTimeSlot,
    itemsTotal,
  });

  // Промокод перепроверяем заново на сервере — ровно по той же причине,
  // что и цены товаров выше: клиент мог заранее проверить код на другую
  // сумму или подставить скидку, которую сервер не подтверждал.
  let promoCodeId: string | null = null;
  let discountAmount = 0;
  if (payload.promoCode?.trim()) {
    const promoResult = await validatePromoCode(payload.promoCode, payload.customerPhone, itemsTotal);
    if (!promoResult.valid) {
      return NextResponse.json({ error: promoResult.error }, { status: 400 });
    }
    promoCodeId = promoResult.promoCodeId;
    discountAmount = promoResult.discountAmount;
  }

  // Резолвим клиента по телефону — источник правды для ФИО/адреса заказа
  // и связки с Posiflora, но НЕ для лимита списания бонусов (см. ниже).
  let customerId: string | null = null;
  let posifloraClientId: string | null = null;
  try {
    const resolved = await resolveOrCreateCustomerByPhone(payload.customerPhone, payload.customerName);
    customerId = resolved.customerId;
    posifloraClientId = resolved.posifloraClientId;
  } catch (error) {
    console.error("Не удалось определить клиента для заказа:", error);
  }

  // Лимит списания бонусов берём ТОЛЬКО из настоящей вошедшей сессии
  // (SMS-код на /login), а не из payload.customerPhone. Раньше баланс
  // резолвился по любому телефону, который прислал клиент в теле
  // запроса, — это позволяло указать чужой номер получателем/заказчиком
  // и списать ЕГО бонусы на скидку себе, зная (или подобрав) только сам
  // номер. Гость без входа бонусов списать не может — currentBonusBalance
  // остаётся 0, что дальше просто обнуляет bonusUsed через тот же Math.min,
  // что был и раньше.
  let currentBonusBalance = 0;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const supabaseAdmin = getSupabaseAdmin();
      const { data: authCustomer } = await supabaseAdmin
        .from("customers")
        .select("id, posiflora_client_id, bonus_balance")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (authCustomer) {
        currentBonusBalance =
          typeof authCustomer.bonus_balance === "string"
            ? Number.parseFloat(authCustomer.bonus_balance)
            : (authCustomer.bonus_balance as number) ?? 0;

        // Живой баланс прямо перед списанием — кэш мог отстать (см.
        // BONUS_SYNC_STALE_MS), а здесь речь о реальном списании денег,
        // а не просто отображении, так что освежаем в любом случае.
        if (authCustomer.posiflora_client_id) {
          const fresh = await refreshCustomerBonusBalance(authCustomer.id, authCustomer.posiflora_client_id);
          if (fresh !== null) currentBonusBalance = fresh;
        }
      }
    }
  } catch (error) {
    console.error("Не удалось определить баланс бонусов вошедшего клиента:", error);
  }

  // Бонусы ограничены суммой, которая осталась ПОСЛЕ скидки по промокоду —
  // иначе промокод и бонусы вместе могли бы увести итог в ноль сверх
  // того, что реально должно быть списано.
  const amountAfterDiscount = Math.max(itemsTotal + deliveryPrice - discountAmount, 0);
  const maxBonus = Math.min(currentBonusBalance, amountAfterDiscount);
  const bonusUsed = Math.min(Math.max(Math.round(payload.bonusUsed ?? 0), 0), maxBonus);
  const totalAmount = Math.max(amountAfterDiscount - bonusUsed, 0);

  const timeSlot = TIME_SLOTS.find((slot) => slot.id === payload.deliveryTimeSlot);
  const orderNumber = generateOrderNumber();

  // --- Posiflora (мок) ---
  // Вызываем до записи в Supabase, чтобы сразу сохранить posiflora_order_id
  // и bonus_earned одним insert'ом, без промежуточного update.
  // Заказ в Posiflora заводит флорист руками: их API не позволяет привязать
  // состав к заказу (см. lib/posiflora/orders.ts). Здесь остаётся точка
  // подключения на будущее — сейчас она ничего не отправляет.
  const posifloraResult = await createPosifloraOrder({
    orderNumber,
    posifloraClientId,
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    items: resolvedItems,
    bonusUsed,
    currentBonusBalance,
  });

  // --- Supabase: запись заказа ---
  const supabaseAdmin = getSupabaseAdmin();

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      order_number: orderNumber,
      posiflora_order_id: posifloraResult.posifloraOrderId,
      customer_id: customerId,

      customer_name: payload.customerName,
      customer_phone: payload.customerPhone,

      recipient_name: payload.isRecipientSelf ? payload.customerName : payload.recipientName,
      recipient_phone: payload.isRecipientSelf ? payload.customerPhone : payload.recipientPhone,
      is_recipient_self: payload.isRecipientSelf,

      is_pickup: payload.isPickup,
      delivery_address: payload.isPickup ? null : payload.deliveryAddress,
      delivery_apartment: payload.isPickup ? null : payload.deliveryApartment || null,
      delivery_date: payload.deliveryDate,
      delivery_time_from: timeSlot?.from ?? null,
      delivery_time_to: timeSlot?.to ?? null,
      courier_comment: payload.courierComment || null,

      card_text: payload.cardText || null,

      items_total: itemsTotal,
      delivery_price: deliveryPrice,
      discount_total: discountAmount,
      bonus_used: bonusUsed,
      bonus_earned: posifloraResult.bonusEarned,
      total_amount: totalAmount,

      status: "new",
      payment_status: "pending",

      admin_comment:
        timeSlot?.id === "asap" ? "Клиент выбрал доставку «как можно скорее»" : null,
    })
    .select()
    .single();

  if (orderError || !order) {
    console.error("Ошибка записи заказа в Supabase:", orderError);
    return NextResponse.json({ error: "Не удалось сохранить заказ" }, { status: 500 });
  }

  // --- Supabase: обновляем кэш баланса бонусов клиента после списания/начисления ---
  // Best-effort — заказ уже создан, сбой здесь не должен превращаться в
  // ошибку оформления, просто на следующей загрузке /account баланс может
  // на секунду отстать (там дальше живой запрос в Posiflora всё равно всё поправит).
  // Кэш баланса СБРАСЫВАЕМ, а не переписываем расчётным числом: сколько
  // бонусов у клиента на самом деле, знает только Posiflora, и начислит их
  // она, когда флорист проведёт заказ. Обнулённая отметка заставит
  // следующий показ /account спросить живой баланс вместо устаревшего.
  if (customerId) {
    const { error: bonusUpdateError } = await supabaseAdmin
      .from("customers")
      .update({ bonus_balance_synced_at: null })
      .eq("id", customerId);

    if (bonusUpdateError) {
      console.error("Не удалось сбросить кэш баланса бонусов после заказа:", bonusUpdateError);
    }
  }

  // --- Supabase: фиксируем использование промокода (best-effort, как и баланс бонусов выше) ---
  if (promoCodeId) {
    await recordPromoCodeRedemption(promoCodeId, order.id, payload.customerPhone, discountAmount);
  }

  // --- Supabase: состав заказа ---
  // product_id не заполняем — каталог из lib/products.ts пока не
  // синхронизирован с таблицей products (это отдельная задача по
  // подключению реальной выгрузки из Posiflora).
  const orderItemsRows = resolvedItems.map((item) => ({
    order_id: order.id,
    product_name: item.name,
    unit_price: item.price,
    quantity: item.quantity,
    total_price: item.price * item.quantity,
  }));

  const { error: itemsError } = await supabaseAdmin.from("order_items").insert(orderItemsRows);

  if (itemsError) {
    console.error("Ошибка записи состава заказа в Supabase:", itemsError);
    // Заказ уже создан — не откатываем, но возвращаем предупреждение,
    // чтобы это было видно в логах/мониторинге.
    return NextResponse.json(
      {
        orderId: order.id,
        orderNumber: order.order_number,
        totalAmount,
        warning: "Заказ создан, но состав сохранить не удалось — нужна ручная проверка",
      },
      { status: 207 }
    );
  }

  // --- Алерт сотрудникам (fire-and-forget) ---
  const recipientName = payload.isRecipientSelf ? payload.customerName : payload.recipientName;
  const recipientPhone = payload.isRecipientSelf ? payload.customerPhone : payload.recipientPhone;
  const deliveryTimeLabel = timeSlot?.label ?? payload.deliveryTimeSlot;
  const address = payload.isPickup
    ? "Самовывоз"
    : `${payload.deliveryAddress}${payload.deliveryApartment ? `, кв. ${payload.deliveryApartment}` : ""}`;
  const itemsCount = resolvedItems.reduce((sum, item) => sum + item.quantity, 0);

  notifyN8n({
    event: "order.created",
    orderNumber: order.order_number,
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    recipientName,
    deliveryDate: payload.deliveryDate,
    deliveryTimeLabel,
    address,
    totalAmount,
    itemsCount,
  });
  // Экранируем всё, что ввёл клиент, — иначе через имя/адрес/комментарий
  // в HTML-уведомление сотруднику можно было бы вставить кликабельную
  // ссылку (Telegram отрисует её как настоящий <a href>). Состав заказа,
  // открытку и комментарий курьеру раньше сюда не включали — флорист
  // видел только количество товаров и сумму, без единой подсказки, что
  // именно собирать (issue замечен 2026-08-20).
  const itemsLines = resolvedItems
    .map((item) => `• ${escapeTelegramHtml(item.name)} × ${item.quantity} — ${item.price * item.quantity} ₽`)
    .join("\n");

  // Клиенту — сразу, а не когда кто-то вспомнит сменить статус. Между
  // «нажал оформить» и первым ответом человек как раз и сомневается,
  // получили ли его заказ вообще.
  void confirmOrderToCustomer(order.id, {
    deliveryDate: payload.deliveryDate,
    timeLabel: timeSlot?.label ?? "время уточним",
    total: totalAmount,
    isPickup: payload.isPickup,
  });

  notifyStaffTelegram(
    `🌸 <b>Новый заказ ${escapeTelegramHtml(order.order_number)}</b>\n\n` +
      `Клиент: ${escapeTelegramHtml(payload.customerName)}, ${escapeTelegramHtml(payload.customerPhone)}\n` +
      `Получатель: ${escapeTelegramHtml(recipientName)}, ${escapeTelegramHtml(recipientPhone)}\n` +
      `${payload.isPickup ? "🏪 <b>САМОВЫВОЗ</b>" : "🚚 Доставка"}: ${escapeTelegramHtml(payload.deliveryDate)}, ${escapeTelegramHtml(deliveryTimeLabel)}\n` +
      `${payload.isPickup ? "Заберут из студии" : `Адрес: ${escapeTelegramHtml(address)}`}\n\n` +
      `<b>Состав:</b>\n${itemsLines}\n` +
      (payload.cardText ? `\n<b>Текст открытки:</b> ${escapeTelegramHtml(payload.cardText)}\n` : "") +
      (payload.courierComment ? `\n<b>Комментарий курьеру:</b> ${escapeTelegramHtml(payload.courierComment)}\n` : "") +
      (discountAmount > 0 ? `\nСкидка по промокоду: −${discountAmount} ₽` : "") +
      `\nСумма: ${totalAmount} ₽`
  );

  return NextResponse.json({
    orderId: order.id,
    orderNumber: order.order_number,
    totalAmount,
    discountAmount,
  });
}
