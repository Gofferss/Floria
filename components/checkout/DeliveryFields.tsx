import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { CONTACTS } from "@/lib/contacts";
import { TIME_SLOTS, ASAP_SURCHARGE, SAME_DAY_CUTOFF_HOUR, MADE_TO_ORDER_LEAD_DAYS } from "@/lib/checkout";

type DeliveryFieldsProps = {
  isPickup: boolean;
  onPickupChange: (value: boolean) => void;
  date: string;
  onDateChange: (value: string) => void;
  /** Самая ранняя доступная дата (YYYY-MM-DD) — считает CheckoutView. */
  minDate: string;
  /** true — в корзине есть букет «под заказ», из-за него сдвинут минимум. */
  hasMadeToOrder: boolean;
  /** true — минимум сдвинут ещё и потому, что уже поздний вечер. */
  isAfterCutoff: boolean;
  timeSlot: string;
  onTimeSlotChange: (value: string) => void;
  street: string;
  onStreetChange: (value: string) => void;
  house: string;
  onHouseChange: (value: string) => void;
  apartment: string;
  onApartmentChange: (value: string) => void;
  comment: string;
  onCommentChange: (value: string) => void;
  errors: { date?: string; timeSlot?: string; street?: string; house?: string };
};

export function DeliveryFields({
  isPickup,
  onPickupChange,
  date,
  onDateChange,
  minDate,
  hasMadeToOrder,
  isAfterCutoff,
  timeSlot,
  onTimeSlotChange,
  street,
  onStreetChange,
  house,
  onHouseChange,
  apartment,
  onApartmentChange,
  comment,
  onCommentChange,
  errors,
}: DeliveryFieldsProps) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink">
        {isPickup ? "Самовывоз" : "Доставка"}
      </h2>

      {/* Переключатель способа получения */}
      <div className="mt-4 inline-flex rounded-full border border-lavender-200 bg-white p-1">
        <button
          type="button"
          onClick={() => onPickupChange(false)}
          className={`rounded-full px-4 py-2 font-body text-sm transition ${
            !isPickup ? "bg-gold-500 text-white" : "text-ink/70 hover:text-ink"
          }`}
        >
          Доставка
        </button>
        <button
          type="button"
          onClick={() => onPickupChange(true)}
          className={`rounded-full px-4 py-2 font-body text-sm transition ${
            isPickup ? "bg-gold-500 text-white" : "text-ink/70 hover:text-ink"
          }`}
        >
          Забрать самому
        </button>
      </div>

      {isPickup && (
        <p className="mt-3 rounded-2xl bg-lavender-50 px-4 py-3 font-body text-sm leading-relaxed text-ink/70">
          Заберёте у нас: <span className="font-medium text-ink">{CONTACTS.addressFull}</span>.
          <br />
          Работаем {CONTACTS.hoursShort}. Позвоним, когда букет будет готов.
        </p>
      )}

      {/* Пояснение, почему недоступны ближайшие даты */}
      {(hasMadeToOrder || isAfterCutoff) && (
        <p className="mt-3 rounded-2xl bg-gold-500/10 px-4 py-3 font-body text-sm leading-relaxed text-ink/75">
          {hasMadeToOrder
            ? `В заказе есть букет «под заказ» — его собирают минимум за ${MADE_TO_ORDER_LEAD_DAYS} дня, чтобы успеть привезти нужные цветы.`
            : `Заказы на сегодня принимаем до ${SAME_DAY_CUTOFF_HOUR}:00.`}{" "}
          Ближайшая доступная дата уже выбрана. Нужно срочнее — позвоните{" "}
          <a href={`tel:${CONTACTS.phoneHref}`} className="font-medium text-gold-700 underline underline-offset-2">
            {CONTACTS.phone}
          </a>
          , постараемся помочь.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label={isPickup ? "Дата получения" : "Дата доставки"}
          htmlFor="deliveryDate"
          required
          error={errors.date}
        >
          <input
            id="deliveryDate"
            type="date"
            min={minDate}
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className={inputClass(!!errors.date)}
          />
        </FormField>

        <div>
          <span className="mb-1.5 block font-display text-sm font-medium text-ink">
            {isPickup ? "Удобное время" : "Время доставки"} <span className="text-gold-600">*</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {TIME_SLOTS.map((slot) => {
              const active = slot.id === timeSlot;
              // Надбавку за срочность показываем прямо на кнопке — чтобы
              // сумма в итоге не стала для клиента сюрпризом.
              const isAsap = slot.id === "asap";
              return (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => onTimeSlotChange(slot.id)}
                  className={`rounded-full border px-3.5 py-1.5 font-body text-sm transition ${
                    active
                      ? "border-gold-500 bg-gold-500 text-white"
                      : "border-lavender-200 bg-white text-ink/70 hover:border-gold-300"
                  }`}
                >
                  {slot.label}
                  {isAsap && !isPickup && (
                    <span className={active ? "text-white/80" : "text-ink/45"}> +{ASAP_SURCHARGE} ₽</span>
                  )}
                </button>
              );
            })}
          </div>
          {errors.timeSlot && (
            <p className="mt-1.5 font-body text-xs text-red-600">{errors.timeSlot}</p>
          )}
        </div>
      </div>

      {!isPickup && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <FormField label="Улица" htmlFor="street" required error={errors.street}>
              <input
                id="street"
                type="text"
                value={street}
                onChange={(e) => onStreetChange(e.target.value)}
                placeholder="Ул. Пушкина"
                className={inputClass(!!errors.street)}
              />
            </FormField>
            <FormField label="Дом" htmlFor="house" required error={errors.house}>
              <input
                id="house"
                type="text"
                value={house}
                onChange={(e) => onHouseChange(e.target.value)}
                placeholder="12"
                className={inputClass(!!errors.house)}
              />
            </FormField>
            <FormField label="Квартира" htmlFor="apartment">
              <input
                id="apartment"
                type="text"
                value={apartment}
                onChange={(e) => onApartmentChange(e.target.value)}
                placeholder="45"
                className={inputClass()}
              />
            </FormField>
          </div>

          <div className="mt-4">
            <FormField
              label="Комментарий для курьера"
              htmlFor="courierComment"
              hint="Домофон, этаж, ориентиры — необязательно"
            >
              <textarea
                id="courierComment"
                value={comment}
                onChange={(e) => onCommentChange(e.target.value)}
                rows={2}
                placeholder="Например: код домофона 45К, 3 этаж"
                className={`${inputClass()} resize-none`}
              />
            </FormField>
          </div>
        </>
      )}
    </section>
  );
}
