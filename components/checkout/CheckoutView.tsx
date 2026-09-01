"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { createSupabaseBrowserClient } from "@/lib/auth/client";
import { ContactFields } from "@/components/checkout/ContactFields";
import { RecipientFields } from "@/components/checkout/RecipientFields";
import { DeliveryFields } from "@/components/checkout/DeliveryFields";
import { CardMessageField } from "@/components/checkout/CardMessageField";
import { OrderSummaryPanel } from "@/components/checkout/OrderSummaryPanel";
import { BloomMark } from "@/components/ui/BloomMark";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/Icons";
import { trackEvent } from "@/lib/analytics/track";
import { CONTACTS } from "@/lib/contacts";
import {
  calcDeliveryPrice,
  earliestDeliveryDate,
  studioNow,
  SAME_DAY_CUTOFF_HOUR,
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
  const [isPickup, setIsPickup] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [street, setStreet] = useState("");
  const [house, setHouse] = useState("");
  const [apartment, setApartment] = useState("");
  const [courierComment, setCourierComment] = useState("");
  const [cardText, setCardText] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);
  const [bonusInput, setBonusInput] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoStatus, setPromoStatus] = useState<"idle" | "checking" | "applied" | "error">("idle");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<"form" | "submitting" | "success">("form");
  // Заказ создан, а ссылку на оплату получить не удалось — редкий, но
  // возможный случай (банк недоступен). Экран успеха должен сказать об этом.
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Реальный баланс бонусов клиента. Раньше подтягивался по номеру,
  // вписанному в форму, — а сервер после отправки заказа доверял этому
  // же номеру для лимита списания. Из-за этого можно было списать чужие
  // бонусы, просто зная (или подобрав) чей-то телефон. Теперь баланс
  // виден и списываем только для реально вошедшей сессии (SMS-код на
  // /login) — /api/customer-bonus больше не принимает номер, отдаёт
  // баланс только текущего пользователя, то же самое проверяет и
  // /api/orders на момент оформления.
  const [availableBonus, setAvailableBonus] = useState(0);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadBonusForSession() {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        if (!cancelled) {
          setIsLoggedIn(false);
          setAvailableBonus(0);
        }
        return;
      }

      try {
        const response = await fetch("/api/customer-bonus");
        const result = await response.json();
        if (cancelled) return;
        setIsLoggedIn(Boolean(result?.loggedIn));
        setAvailableBonus(Number(result?.bonusBalance) || 0);
      } catch (error) {
        console.error("Не удалось получить баланс бонусов:", error);
        if (!cancelled) {
          setIsLoggedIn(false);
          setAvailableBonus(0);
        }
      }
    }

    loadBonusForSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // «Под заказ» в корзине сдвигает минимальную дату — товар нужно успеть
  // собрать. Итоговую проверку всё равно делает сервер, здесь — подсказка
  // и ограничение календаря, чтобы клиент не выбрал заведомо невозможное.
  const hasMadeToOrder = useMemo(
    () => items.some((item) => item.availabilityMode === "made_to_order"),
    [items]
  );
  const minDate = useMemo(() => earliestDeliveryDate({ hasMadeToOrder }), [hasMadeToOrder]);
  const isAfterCutoff = useMemo(() => studioNow().getUTCHours() >= SAME_DAY_CUTOFF_HOUR, []);

  // Если выбранная дата стала недоступной (сменили корзину, наступил
  // вечер) — подставляем ближайшую возможную, чтобы форма не отправляла
  // заведомо отклоняемое значение.
  useEffect(() => {
    if (!deliveryDate || deliveryDate < minDate) setDeliveryDate(minDate);
  }, [minDate, deliveryDate]);

  const deliveryPrice = calcDeliveryPrice({ isPickup, timeSlot, itemsTotal: subtotal });
  // Бонусы ограничены суммой ПОСЛЕ скидки по промокоду — тот же порядок,
  // что и на сервере (см. /api/orders), иначе тут показали бы клиенту
  // лимит бонусов больше, чем сервер реально позволит списать.
  const amountAfterDiscount = Math.max(subtotal + deliveryPrice - promoDiscount, 0);
  const maxBonus = Math.min(availableBonus, amountAfterDiscount);
  const bonusApplied = Math.min(Math.max(Number(bonusInput) || 0, 0), maxBonus);
  const total = Math.max(amountAfterDiscount - bonusApplied, 0);

  async function handleApplyPromo() {
    if (!promoInput.trim() || promoStatus === "checking") return;

    if (!isValidPhone(customerPhone)) {
      setPromoStatus("error");
      setPromoError("Сначала укажите ваш телефон");
      return;
    }

    setPromoStatus("checking");
    setPromoError(null);

    try {
      const response = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoInput, customerPhone, itemsTotal: subtotal }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Не удалось проверить промокод");
      }

      setAppliedPromoCode(promoInput.trim().toUpperCase());
      setPromoDiscount(Number(result?.discountAmount) || 0);
      setPromoStatus("applied");
    } catch (error) {
      setAppliedPromoCode(null);
      setPromoDiscount(0);
      setPromoStatus("error");
      setPromoError(error instanceof Error ? error.message : "Не удалось проверить промокод");
    }
  }

  function handleRemovePromo() {
    setAppliedPromoCode(null);
    setPromoDiscount(0);
    setPromoStatus("idle");
    setPromoError(null);
    setPromoInput("");
  }

  // Промокод проверен под конкретный телефон (лимит "на клиента" считается
  // по нему) — если телефон поменяли после применения, старая проверка
  // больше не гарантированно верна, просим применить код заново.
  useEffect(() => {
    if (appliedPromoCode) handleRemovePromo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerPhone]);

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
    else if (deliveryDate < minDate) next.deliveryDate = "На эту дату уже нельзя — выберите позже";
    if (!timeSlot) next.timeSlot = "Выберите время";
    // При самовывозе адрес не нужен — клиент забирает из студии.
    if (!isPickup) {
      if (!street.trim()) next.street = "Укажите улицу";
      if (!house.trim()) next.house = "Укажите номер дома";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (items.length === 0 || status === "submitting") return;
    if (!consentGiven) return;
    if (!validate()) return;

    trackEvent("button_click", "Перейти к оплате");
    setStatus("submitting");
    setSubmitError(null);

    const payload: CheckoutPayload = {
      customerName,
      customerPhone,
      isRecipientSelf,
      recipientName: isRecipientSelf ? customerName : recipientName,
      recipientPhone: isRecipientSelf ? customerPhone : recipientPhone,
      isPickup,
      deliveryDate,
      deliveryTimeSlot: timeSlot,
      deliveryAddress: isPickup ? "" : `${street}, ${house}`,
      deliveryApartment: isPickup ? "" : apartment,
      courierComment: isPickup ? "" : courierComment,
      cardText,
      bonusUsed: bonusApplied,
      promoCode: appliedPromoCode,
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

      // ================================================================
      // Заказ создан — уводим на оплату.
      //
      // Корзину чистим ДО перехода: человек уходит на сайт банка и может
      // вернуться кнопкой «назад». Если корзина останется полной, он
      // увидит те же букеты и оформит второй такой же заказ.
      //
      // Сбой создания платежа НЕ откатывает заказ: он уже в базе, и
      // правильнее показать «оплатите по ссылке», чем стереть всё, что
      // человек заполнял пять минут.
      // ================================================================
      clear();

      const payResponse = await fetch("/api/payments/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: result?.orderId }),
      });

      const payResult = await payResponse.json().catch(() => null);

      if (payResponse.ok && payResult?.paymentUrl) {
        window.location.href = payResult.paymentUrl as string;
        return;
      }

      console.error("Не удалось создать оплату:", payResult?.error);
      setPaymentFailed(true);
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
        {paymentFailed ? (
          // Сюда попадают, только если заказ создался, а платёж — нет.
          // Не делаем вид, что всё хорошо: человек ждёт оплаты, и молчание
          // про неё обернётся звонком «а вы мой заказ получили?».
          <p className="mt-3 font-body text-base leading-relaxed text-ink/60">
            Заказ сохранён, но открыть оплату не получилось. Мы позвоним вам на{" "}
            {customerPhone} и поможем оплатить — или наберите нас сами, номер внизу
            страницы.
          </p>
        ) : (
          <p className="mt-3 font-body text-base leading-relaxed text-ink/60">
            Мы свяжемся с вами по телефону {customerPhone} в ближайшее время, чтобы
            подтвердить детали. Спасибо, что выбрали Floria!
          </p>
        )}
        <Link
          href="/catalog"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-gold-600"
        >
          Вернуться в каталог
          <ArrowRightIcon className="h-4 w-4" />
        </Link>

        {/* Момент, когда предложение уместно: повод уже есть, дата известна */}
        <div className="mt-10 w-full rounded-3xl border border-lavender-200 bg-lavender-50/60 p-5 text-left sm:p-6">
          <p className="font-display text-sm font-semibold text-ink">
            Чтобы в следующий раз не вспоминать в последний момент
          </p>
          <p className="mt-1.5 font-body text-sm leading-relaxed text-ink/65">
            Наш Telegram-бот напомнит о дате заранее — за столько дней, сколько попросите.
            Заодно покажет бонусный баланс.
          </p>
          <a
            href={CONTACTS.telegramBot}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 font-display text-sm font-semibold text-lavender-700 underline underline-offset-4 transition hover:text-lavender-600"
          >
            Настроить напоминание
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    );
  }

  // ---------- Пустая корзина ----------
  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center sm:px-6">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-lavender-100 to-gold-50 text-lavender-400">
          <BloomMark className="h-11 w-11" />
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
            isPickup={isPickup}
            onPickupChange={setIsPickup}
            date={deliveryDate}
            onDateChange={setDeliveryDate}
            minDate={minDate}
            hasMadeToOrder={hasMadeToOrder}
            isAfterCutoff={isAfterCutoff}
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
            promoInput={promoInput}
            onPromoInputChange={setPromoInput}
            onApplyPromo={handleApplyPromo}
            onRemovePromo={handleRemovePromo}
            appliedPromoCode={appliedPromoCode}
            promoDiscount={promoDiscount}
            promoStatus={promoStatus}
            promoError={promoError}
            bonusInput={bonusInput}
            onBonusInputChange={setBonusInput}
            bonusApplied={bonusApplied}
            availableBonus={maxBonus}
            isLoggedIn={isLoggedIn}
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
