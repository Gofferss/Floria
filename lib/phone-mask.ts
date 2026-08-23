/**
 * Форматирует ввод в маску "+7 (978) 726-57-64" по мере набора.
 * Понимает ввод с "8", с "+7" или просто 10 цифр — везде приводит
 * к единому виду. Пустой ввод даёт пустую строку (не "залипший" префикс
 * "+7", который нельзя стереть бэкспейсом).
 */
export function formatRussianPhoneInput(raw: string): string {
  const digitsOnly = raw.replace(/\D/g, "");
  if (digitsOnly === "") return "";

  let digits = digitsOnly;
  if (digits.startsWith("8") || digits.startsWith("7")) digits = digits.slice(1);
  digits = digits.slice(0, 10);

  let result = "+7";
  if (digits.length === 0) return result;

  result += ` (${digits.slice(0, 3)}`;
  if (digits.length >= 3) result += ")";
  if (digits.length > 3) result += ` ${digits.slice(3, 6)}`;
  if (digits.length > 6) result += `-${digits.slice(6, 8)}`;
  if (digits.length > 8) result += `-${digits.slice(8, 10)}`;

  return result;
}

/**
 * Приводит отформатированный (или любой) ввод к E.164 для Supabase
 * (`+7XXXXXXXXXX`). null, если после нормализации не набралось ровно
 * 10 цифр после кода страны — форма не должна отправлять такое на сервер.
 */
export function toE164RussianPhone(value: string): string | null {
  const digitsOnly = value.replace(/\D/g, "");
  let digits = digitsOnly;
  if (digits.startsWith("8") || digits.startsWith("7")) digits = digits.slice(1);

  if (digits.length !== 10) return null;
  return `+7${digits}`;
}

/**
 * То же, что toE164RussianPhone, но бросает исключение вместо null.
 *
 * Для мест, где номер уже прошёл валидацию на входе и невалидное значение
 * означает испорченные данные, а не штатную ветку — прежде всего для работы
 * с customers.phone: раньше номер писался в базу «как пришёл» (Supabase Auth
 * отдаёт "79787265766", форма заказа — "+7 (978) 726-57-66"), поиск шёл
 * точным совпадением строки, и на одного человека заводилось несколько
 * карточек. Отсюда же брался конфликт по customers_posiflora_client_id_key,
 * вешавший личный кабинет.
 */
export function requireE164RussianPhone(value: string): string {
  const normalized = toE164RussianPhone(value);
  if (!normalized) {
    throw new Error(`Не удалось нормализовать номер телефона: "${value}"`);
  }
  return normalized;
}
