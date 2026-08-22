export const TIME_SLOTS = [
  { id: "asap", label: "Как можно скорее", from: null, to: null },
  { id: "10-13", label: "10:00–13:00", from: "10:00", to: "13:00" },
  { id: "13-16", label: "13:00–16:00", from: "13:00", to: "16:00" },
  { id: "16-19", label: "16:00–19:00", from: "16:00", to: "19:00" },
  { id: "19-22", label: "19:00–22:00", from: "19:00", to: "22:00" },
] as const;

export const DELIVERY_PRICE = 300;

/** Срочная доставка «как можно скорее» — курьер едет вне общего маршрута. */
export const ASAP_SURCHARGE = 150;

/**
 * После этого часа заказ «на сегодня» уже не оформить: студия работает
 * до 22:00, и за оставшийся час собрать букет и довезти нереально.
 * Клиенту остаётся выбрать следующий день (или позвонить и договориться).
 */
export const SAME_DAY_CUTOFF_HOUR = 21;

/**
 * Букеты «под заказ» не собираются день в день — нужно время найти и
 * привезти нужный цветок. Минимальный срок в днях от текущей даты.
 */
export const MADE_TO_ORDER_LEAD_DAYS = 2;

/**
 * Симферополь живёт по московскому времени (UTC+3) круглый год, перевода
 * на летнее/зимнее нет. Считаем «сейчас» по студии явно, а не по часам
 * сервера: контейнер на проде работает в UTC, и без этой поправки
 * отсечка 21:00 срабатывала бы на три часа позже, чем нужно.
 */
export const STUDIO_UTC_OFFSET_HOURS = 3;

/** Дата-время «сейчас» в часовом поясе студии, как обычный Date в UTC-полях. */
export function studioNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + STUDIO_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/**
 * Самая ранняя дата, на которую можно оформить доставку (YYYY-MM-DD).
 * Одна и та же функция используется формой и сервером — иначе клиент
 * увидел бы одни правила, а сервер применил другие.
 */
export function earliestDeliveryDate(options: { hasMadeToOrder: boolean; now?: Date }): string {
  const studio = studioNow(options.now);

  // После отсечки сегодняшний день уже недоступен.
  let earliest = studio.getUTCHours() >= SAME_DAY_CUTOFF_HOUR ? addDays(studio, 1) : studio;

  if (options.hasMadeToOrder) {
    const leadDate = addDays(studio, MADE_TO_ORDER_LEAD_DAYS);
    if (leadDate > earliest) earliest = leadDate;
  }

  return toISODate(earliest);
}

/** Стоимость доставки: самовывоз бесплатно, срочность — с надбавкой. */
export function calcDeliveryPrice(options: { isPickup: boolean; timeSlot: string; itemsTotal: number }): number {
  if (options.isPickup || options.itemsTotal === 0) return 0;
  return DELIVERY_PRICE + (options.timeSlot === "asap" ? ASAP_SURCHARGE : 0);
}

export type CheckoutItem = {
  productSlug: string;
  name: string;
  size: string;
  price: number;
  quantity: number;
  image?: string;
};

// Форма полей 1:1 повторяет таблицу `orders` из Шага 1 — это тело будущего
// запроса POST /api/orders (см. ARCHITECTURE.md).
export type CheckoutPayload = {
  customerName: string;
  customerPhone: string;
  isRecipientSelf: boolean;
  recipientName: string;
  recipientPhone: string;
  /** true — клиент забирает сам, адрес и стоимость доставки не нужны. */
  isPickup: boolean;
  deliveryDate: string;
  deliveryTimeSlot: string;
  deliveryAddress: string;
  deliveryApartment: string;
  courierComment: string;
  cardText: string;
  bonusUsed: number;
  /** Промокод как ввёл клиент — сервер перепроверяет его сам, не доверяя скидке с клиента. */
  promoCode: string | null;
  items: CheckoutItem[];
  itemsTotal: number;
  deliveryPrice: number;
  totalAmount: number;
};

export function isValidPhone(value: string): boolean {
  return value.replace(/\D/g, "").length >= 10;
}
