export const TIME_SLOTS = [
  { id: "asap", label: "Как можно скорее", from: null, to: null },
  { id: "10-13", label: "10:00–13:00", from: "10:00", to: "13:00" },
  { id: "13-16", label: "13:00–16:00", from: "13:00", to: "16:00" },
  { id: "16-19", label: "16:00–19:00", from: "16:00", to: "19:00" },
  { id: "19-22", label: "19:00–22:00", from: "19:00", to: "22:00" },
] as const;

export const DELIVERY_PRICE = 300;
export const FREE_DELIVERY_THRESHOLD = 5000;

export type CheckoutItem = {
  productSlug: string;
  name: string;
  size: string;
  price: number;
  quantity: number;
};

// Форма полей 1:1 повторяет таблицу `orders` из Шага 1 — это тело будущего
// запроса POST /api/orders (см. ARCHITECTURE.md).
export type CheckoutPayload = {
  customerName: string;
  customerPhone: string;
  isRecipientSelf: boolean;
  recipientName: string;
  recipientPhone: string;
  deliveryDate: string;
  deliveryTimeSlot: string;
  deliveryAddress: string;
  deliveryApartment: string;
  courierComment: string;
  cardText: string;
  bonusUsed: number;
  items: CheckoutItem[];
  itemsTotal: number;
  deliveryPrice: number;
  totalAmount: number;
};

export function isValidPhone(value: string): boolean {
  return value.replace(/\D/g, "").length >= 10;
}
