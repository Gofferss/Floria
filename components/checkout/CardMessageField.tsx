import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";

const MAX_LENGTH = 200;

type CardMessageFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** Галочка «не указывать отправителя» — только для букета другому человеку. */
  showAnonymous: boolean;
  anonymous: boolean;
  onAnonymousChange: (value: boolean) => void;
};

export function CardMessageField({ value, onChange, showAnonymous, anonymous, onAnonymousChange }: CardMessageFieldProps) {
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

      {showAnonymous && (
        <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-2xl border border-lavender-200 bg-white/60 p-4 transition hover:border-gold-400">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => onAnonymousChange(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-gold-500"
          />
          <span>
            <span className="block font-body text-sm font-medium text-ink">Не указывать отправителя</span>
            <span className="mt-0.5 block font-body text-xs text-ink/50">
              Получатель не узнает, от кого букет: открытку не подпишем, курьер не назовёт ваше имя. Если в тексте
              открытки есть подпись — уберите её.
            </span>
          </span>
        </label>
      )}
    </section>
  );
}
