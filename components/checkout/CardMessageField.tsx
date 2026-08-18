import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";

const MAX_LENGTH = 200;

type CardMessageFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

export function CardMessageField({ value, onChange }: CardMessageFieldProps) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink">Открытка к букету</h2>
      <p className="mt-1 font-body text-sm text-ink/50">
        Бесплатно. Впишем от руки на карточке и приложим к букету.
      </p>
      <div className="mt-4">
        <FormField label="Текст открытки" htmlFor="cardText">
          <textarea
            id="cardText"
            value={value}
            maxLength={MAX_LENGTH}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            placeholder="Например: С днём рождения! Пусть этот год будет самым ярким"
            className={`${inputClass()} resize-none`}
          />
        </FormField>
        <p className="mt-1.5 text-right font-body text-xs text-ink/40">
          {value.length}/{MAX_LENGTH}
        </p>
      </div>
    </section>
  );
}
