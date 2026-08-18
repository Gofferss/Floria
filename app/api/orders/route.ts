import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createPosifloraOrder } from "@/lib/posiflora";
import { resolveOrCreateCustomerByPhone } from "@/lib/customer-sync";
import { toE164RussianPhone } from "@/lib/phone-mask";
import { notifyN8n, notifyStaffTelegram } from "@/lib/n8n";
import {
  DELIVERY_PRICE,
  FREE_DELIVERY_THRESHOLD,
  TIME_SLOTS,
  type CheckoutPayload,
} from "@/lib/checkout";

// Используем service-role ключ Supabase и Node-совместимые API — нужен
// node-рантайм, не edge.
export const runtime = "nodejs";

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
  if (!payload.deliveryAddress?.trim()) {
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
      item.price < 0 ||
      item.quantity < 1
    ) {
      return { valid: false, error: "Некорректный состав заказа" };
    }
  }

  return { valid: true, data: payload as CheckoutPayload };
}

function generateOrderNumber(): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `FL-${time}${random}`;
}

export async function POST(request: Request) {
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

  // Суммы пересчитываем на сервере — не доверяем итогам, посчитанным на
  // клиенте (клиент мог отправить что угодно).
  const itemsTotal = payload.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryPrice = itemsTotal >= FREE_DELIVERY_THRESHOLD || itemsTotal === 0 ? 0 : DELIVERY_PRICE;

  // Резолвим клиента по телефону — источник правды для лимита списания
  // бонусов. Раньше лимит был захардкожен константой (AVAILABLE_BONUS_DEMO
  // = 480) и любой посетитель мог списать до 480 бонусов вне зависимости
  // от реального баланса. При сбое (Posiflora/БД недоступны) — безопасный
  // дефолт: 0 бонусов, а не доверие тому, что прислал клиент.
  let customerId: string | null = null;
  let posifloraClientId: string | null = null;
  let currentBonusBalance = 0;
  try {
    const resolved = await resolveOrCreateCustomerByPhone(payload.customerPhone, payload.customerName);
    customerId = resolved.customerId;
    posifloraClientId = resolved.posifloraClientId;
    currentBonusBalance = resolved.bonusBalance;
  } catch (error) {
    console.error("Не удалось определить клиента для заказа:", error);
  }

  const maxBonus = Math.min(currentBonusBalance, itemsTotal + deliveryPrice);
  const bonusUsed = Math.min(Math.max(Math.round(payload.bonusUsed ?? 0), 0), maxBonus);
  const totalAmount = Math.max(itemsTotal + deliveryPrice - bonusUsed, 0);

  const timeSlot = TIME_SLOTS.find((slot) => slot.id === payload.deliveryTimeSlot);
  const orderNumber = generateOrderNumber();

  // --- Posiflora (мок) ---
  // Вызываем до записи в Supabase, чтобы сразу сохранить posiflora_order_id
  // и bonus_earned одним insert'ом, без промежуточного update.
  let posifloraResult: { posifloraOrderId: string | null; bonusEarned: number; bonusBalanceAfter: number };
  try {
    posifloraResult = await createPosifloraOrder({
      orderNumber,
      posifloraClientId,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      items: payload.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
      bonusUsed,
      currentBonusBalance,
    });
  } catch (error) {
    console.error("Ошибка интеграции с Posiflora:", error);
    // Не блокируем оформление заказа из-за сбоя кассы — заказ уходит в
    // статус 'new' без posiflora_order_id, менеджер обработает вручную.
    // Баланс всё равно уменьшаем локально на использованные бонусы, чтобы
    // их нельзя было списать повторно на следующем заказе.
    posifloraResult = {
      posifloraOrderId: null,
      bonusEarned: 0,
      bonusBalanceAfter: Math.max(0, currentBonusBalance - bonusUsed),
    };
  }

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

      delivery_address: payload.deliveryAddress,
      delivery_apartment: payload.deliveryApartment || null,
      delivery_date: payload.deliveryDate,
      delivery_time_from: timeSlot?.from ?? null,
      delivery_time_to: timeSlot?.to ?? null,
      courier_comment: payload.courierComment || null,

      card_text: payload.cardText || null,

      items_total: itemsTotal,
      delivery_price: deliveryPrice,
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
  if (customerId) {
    const { error: bonusUpdateError } = await supabaseAdmin
      .from("customers")
      .update({
        bonus_balance: posifloraResult.bonusBalanceAfter,
        bonus_balance_synced_at: new Date().toISOString(),
      })
      .eq("id", customerId);

    if (bonusUpdateError) {
      console.error("Не удалось обновить баланс бонусов после заказа:", bonusUpdateError);
    }
  }

  // --- Supabase: состав заказа ---
  // product_id не заполняем — каталог из lib/products.ts пока не
  // синхронизирован с таблицей products (это отдельная задача по
  // подключению реальной выгрузки из Posiflora).
  const orderItemsRows = payload.items.map((item) => ({
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
  const deliveryTimeLabel = timeSlot?.label ?? payload.deliveryTimeSlot;
  const address = `${payload.deliveryAddress}${payload.deliveryApartment ? `, кв. ${payload.deliveryApartment}` : ""}`;
  const itemsCount = payload.items.reduce((sum, item) => sum + item.quantity, 0);

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
  notifyStaffTelegram(
    `🌸 <b>Новый заказ ${order.order_number}</b>\n\n` +
      `Клиент: ${payload.customerName}, ${payload.customerPhone}\n` +
      `Получатель: ${recipientName}\n` +
      `Доставка: ${payload.deliveryDate}, ${deliveryTimeLabel}\n` +
      `Адрес: ${address}\n` +
      `Товаров: ${itemsCount} шт\n` +
      `Сумма: ${totalAmount} ₽`
  );

  return NextResponse.json({
    orderId: order.id,
    orderNumber: order.order_number,
    totalAmount,
  });
}
