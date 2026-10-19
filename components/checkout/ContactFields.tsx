import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { formatRussianPhoneInput } from "@/lib/phone-mask";

type ContactFieldsProps = {
  name: string;
  phone: string;
  email: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  errors: { name?: string; phone?: string; email?: string };
};

export function ContactFields({
  name,
  phone,
  email,
  onNameChange,
  onPhoneChange,
  onEmailChange,
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

      {/*
        Почта обязательна с появлением онлайн-оплаты: по 54-ФЗ на неё
        уходит фискальный чек, который выбивает оператор фискальных данных
        через платёжный шлюз. Без адреса чек всё равно будет создан, но
        придёт не покупателю, а на адрес студии из настроек эквайринга —
        то есть человек останется без документа о покупке.

        Подпись под полем объясняет это прямо: поле, которое просит данные
        без причины, люди заполняют неохотно и неверно.
      */}
      <div className="mt-4">
        <FormField label="Электронная почта" htmlFor="customerEmail" required error={errors.email}>
          <input
            id="customerEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="name@example.com"
            className={inputClass(!!errors.email)}
          />
        </FormField>
        <p className="mt-1.5 font-body text-xs leading-relaxed text-ink/50">
          Пришлём на неё кассовый чек после оплаты. Рекламой не беспокоим.
        </p>
      </div>
    </section>
  );
}
