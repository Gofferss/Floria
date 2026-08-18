import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { formatRussianPhoneInput } from "@/lib/phone-mask";

type RecipientFieldsProps = {
  isSelf: boolean;
  onToggleSelf: (value: boolean) => void;
  name: string;
  phone: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  errors: { name?: string; phone?: string };
};

export function RecipientFields({
  isSelf,
  onToggleSelf,
  name,
  phone,
  onNameChange,
  onPhoneChange,
  errors,
}: RecipientFieldsProps) {
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-ink">Получатель</h2>
        <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-ink/70">
          <input
            type="checkbox"
            checked={isSelf}
            onChange={(e) => onToggleSelf(e.target.checked)}
            className="h-4 w-4 rounded border-lavender-300 accent-gold-500"
          />
          Я получатель
        </label>
      </div>

      {!isSelf && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Имя получателя" htmlFor="recipientName" required error={errors.name}>
            <input
              id="recipientName"
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Имя того, кому дарите"
              className={inputClass(!!errors.name)}
            />
          </FormField>
          <FormField label="Телефон получателя" htmlFor="recipientPhone" required error={errors.phone}>
            <input
              id="recipientPhone"
              type="tel"
              value={phone}
              onChange={(e) => onPhoneChange(formatRussianPhoneInput(e.target.value))}
              placeholder="+7 (___) ___-__-__"
              className={inputClass(!!errors.phone)}
            />
          </FormField>
        </div>
      )}
    </section>
  );
}
