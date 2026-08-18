import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { formatRussianPhoneInput } from "@/lib/phone-mask";

type ContactFieldsProps = {
  name: string;
  phone: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  errors: { name?: string; phone?: string };
};

export function ContactFields({
  name,
  phone,
  onNameChange,
  onPhoneChange,
  errors,
}: ContactFieldsProps) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink">Контакты заказчика</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Имя" htmlFor="customerName" required error={errors.name}>
          <input
            id="customerName"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Как к вам обращаться"
            className={inputClass(!!errors.name)}
          />
        </FormField>
        <FormField label="Телефон" htmlFor="customerPhone" required error={errors.phone}>
          <input
            id="customerPhone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => onPhoneChange(formatRussianPhoneInput(e.target.value))}
            placeholder="+7 (___) ___-__-__"
            className={inputClass(!!errors.phone)}
          />
        </FormField>
      </div>
    </section>
  );
}
