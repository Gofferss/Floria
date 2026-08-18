"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { ContactFields } from "@/components/checkout/ContactFields";
import { RecipientFields } from "@/components/checkout/RecipientFields";
import { DeliveryFields } from "@/components/checkout/DeliveryFields";
import { CardMessageField } from "@/components/checkout/CardMessageField";
import { OrderSummaryPanel } from "@/components/checkout/OrderSummaryPanel";
import { BotanicalPattern } from "@/components/ui/BotanicalPattern";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/Icons";
import { toE164RussianPhone } from "@/lib/phone-mask";
import {
  DELIVERY_PRICE,
  FREE_DELIVERY_THRESHOLD,
  isValidPhone,
  type CheckoutPayload,
} from "@/lib/checkout";

type FormErrors = Partial<
  Record<
    | "customerName"
    | "customerPhone"
    | "recipientName"
    | "recipientPhone"
    | "deliveryDate"
    | "timeSlot"
    | "street"
    | "house",
    string
  >
>;

export function CheckoutView() {
  const { items, subtotal, clear } = useCart();

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [isRecipientSelf, setIsRecipientSelf] = useState(true);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [street, setStreet] = useState("");
  const [house, setHouse] = useState("");
  const [apartment, setApartment] = useState("");
  const [courierComment, setCourierComment] = useState("");
  const [cardText, setCardText] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);
  const [bonusInput, setBonusInput] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<"form" | "submitting" | "success">("form");
  const [orderNumber, setOrderNumber] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Реальный баланс бонусов клиента — раньше здесь была захардкоженная
  // демо-константа 480, из-за которой любой посетитель мог списать до 480
  // бонусов вне зависимости от того, сколько у него есть на самом деле.
  // Подгружается по мере ввода телефона; окончательный лимит всё равно
  // пересчитывается на сервере при отправке заказа (см. /api/orders) — этот
  // подтягивается только для честного отображения в форме.
  const [availableBonus, setAvailableBonus] = useState(0);

  useEffect(() => {
    const normalizedPhone = toE164RussianPhone(customerPhone);
    if (!normalizedPhone) {
      setAvailableBonus(0);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/customer-bonus?phone=${encodeURIComponent(normalizedPhone)}`);
        const result = await response.json();
        if (!cancelled) setAvailableBonus(Number(result?.bonusBalance) || 0);
      } catch (error) {
        console.error("Не удалось получить баланс бонусов:", error);
        if (!cancelled) setAvailableBonus(0);
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [customerPhone]);

  const deliveryPrice = subtotal === 0 || subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_PRICE;
  const maxBonus = Math.min(availableBonus, subtotal + deliveryPrice);
  const bonusApplied = Math.min(Math.max(Number(bonusInput) || 0, 0), maxBonus);
  const total = Math.max(subtotal + deliveryPrice - bonusApplied, 0);

  const checkoutItems = useMemo(
    () =>
      items.map((item) => ({
        productSlug: item.productSlug,
        name: item.name,
        size: item.size,
        price: item.price,
        quantity: item.quantity,
        image: item.image,
      })),
    [items]
  );

  function validate(): boolean {
    const next: FormErrors = {};
    if (!customerName.trim()) next.customerName = "Укажите имя";
    if (!isValidPhone(customerPhone)) next.customerPhone = "Проверьте номер телефона";
    if (!isRecipientSelf) {
      if (!recipientName.trim()) next.recipientName = "Укажите имя получателя";
      if (!isValidPhone(recipientPhone)) next.recipientPhone = "Проверьте номер телефона";
    }
    if (!deliveryDate) next.deliveryDate = "Выберите дату";
    if (!timeSlot) next.timeSlot = "Выберите время";
    if (!street.trim()) next.street = "Укажите улицу";
    if (!house.trim()) next.house = "Укажите номер дома";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (items.length === 0 || status === "submitting") return;
    if (!consentGiven) return;
    if (!validate()) return;

    setStatus("submitting");
    setSubmitError(null);

    const payload: CheckoutPayload = {
      customerName,
      customerPhone,
      isRecipientSelf,
      recipientName: isRecipientSelf ? customerName : recipientName,
      recipientPhone: isRecipientSelf ? customerPhone : recipientPhone,
      deliveryDate,
      deliveryTimeSlot: timeSlot,
      deliveryAddress: `${street}, ${house}`,
      deliveryApartment: apartment,
      courierComment,
      cardText,
      bonusUsed: bonusApplied,
      items: checkoutItems,
      itemsTotal: subtotal,
      deliveryPrice,
      totalAmount: total,
    };

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Не удалось оформить заказ. Попробуйте ещё раз.");
      }

      setOrderNumber(result?.orderNumber ?? "");
      clear();
      setStatus("success");
    } catch (error) {
      console.error("Ошибка оформления заказа:", error);
      setSubmitError(
        error instanceof Error ? error.message : "Не удалось оформить заказ. Попробуйте ещё раз."
      );
      setStatus("form");
    }
  }

  // ---------- Экран успеха ----------
  if (status === "success") {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center sm:px-6">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gold-500 text-white">
          <CheckIcon className="h-7 w-7" />
        </span>
        <h1 className="mt-6 font-display text-2xl font-bold text-ink sm:text-3xl">
          Заказ {orderNumber} принят
        </h1>
        <p className="mt-3 font-body text-base leading-relaxed text-ink/60">
          Мы свяжемся с вами по телефону {customerPhone} в ближайшее время, чтобы
          подтвердить детали и оплату. Спасибо, что выбрали Floria!
        </p>
        <Link
          href="/catalog"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-gold-600"
        >
          Вернуться в каталог
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  // ---------- Пустая корзина ----------
  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center sm:px-6">
        <div className="relative h-24 w-24 text-lavender-300">
          <BotanicalPattern className="h-full w-full" />
        </div>
        <h1 className="mt-6 font-display text-2xl font-bold text-ink">Корзина пуста</h1>
        <p className="mt-3 font-body text-base text-ink/60">
          Добавьте букет из каталога, чтобы оформить заказ.
        </p>
        <Link
          href="/catalog"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-gold-600"
        >
          В каталог
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  // ---------- Форма ----------
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
        Оформление заказа
      </span>
      <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">
        Почти готово
      </h1>

      {submitError && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700">
          {submitError}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_380px] lg:gap-14">
        <div className="flex flex-col gap-8 divide-y divide-lavender-100 [&>section:not(:first-child)]:pt-8">
          <ContactFields
            name={customerName}
            phone={customerPhone}
            onNameChange={setCustomerName}
            onPhoneChange={setCustomerPhone}
            errors={{ name: errors.customerName, phone: errors.customerPhone }}
          />
          <RecipientFields
            isSelf={isRecipientSelf}
            onToggleSelf={setIsRecipientSelf}
            name={recipientName}
            phone={recipientPhone}
            onNameChange={setRecipientName}
            onPhoneChange={setRecipientPhone}
            errors={{ name: errors.recipientName, phone: errors.recipientPhone }}
          />
          <DeliveryFields
            date={deliveryDate}
            onDateChange={setDeliveryDate}
            timeSlot={timeSlot}
            onTimeSlotChange={setTimeSlot}
            street={street}
            onStreetChange={setStreet}
            house={house}
            onHouseChange={setHouse}
            apartment={apartment}
            onApartmentChange={setApartment}
            comment={courierComment}
            onCommentChange={setCourierComment}
            errors={{
              date: errors.deliveryDate,
              timeSlot: errors.timeSlot,
              street: errors.street,
              house: errors.house,
            }}
          />
          <CardMessageField value={cardText} onChange={setCardText} />
        </div>

        <div className="lg:sticky lg:top-28 lg:self-start">
          <OrderSummaryPanel
            items={checkoutItems}
            itemsTotal={subtotal}
            deliveryPrice={deliveryPrice}
            bonusInput={bonusInput}
            onBonusInputChange={setBonusInput}
            bonusApplied={bonusApplied}
            availableBonus={maxBonus}
            total={total}
            onSubmit={handleSubmit}
            isSubmitting={status === "submitting"}
            consentGiven={consentGiven}
            onConsentChange={setConsentGiven}
          />
        </div>
      </div>
    </div>
  );
}
