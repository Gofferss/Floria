import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { TIME_SLOTS } from "@/lib/checkout";

type DeliveryFieldsProps = {
  date: string;
  onDateChange: (value: string) => void;
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

const todayISO = new Date().toISOString().slice(0, 10);

export function DeliveryFields({
  date,
  onDateChange,
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
      <h2 className="font-display text-lg font-semibold text-ink">Доставка</h2>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Дата доставки" htmlFor="deliveryDate" required error={errors.date}>
          <input
            id="deliveryDate"
            type="date"
            min={todayISO}
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className={inputClass(!!errors.date)}
          />
        </FormField>

        <div>
          <span className="mb-1.5 block font-display text-sm font-medium text-ink">
            Время доставки <span className="text-gold-600">*</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {TIME_SLOTS.map((slot) => {
              const active = slot.id === timeSlot;
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
                </button>
              );
            })}
          </div>
          {errors.timeSlot && (
            <p className="mt-1.5 font-body text-xs text-red-600">{errors.timeSlot}</p>
          )}
        </div>
      </div>

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
    </section>
  );
}
