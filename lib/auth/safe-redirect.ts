/**
 * Куда вернуть человека после входа — только на страницу этого же сайта.
 *
 * Адрес приходит из ссылки (?redirect=...), а ссылку может составить кто
 * угодно. Без проверки «https://чужой-сайт» или «//чужой-сайт» увёл бы
 * человека со страницы входа наружу — уже после того, как он ввёл код и
 * доверился странице. Разрешаем только путь от корня этого сайта.
 *
 * Проверки «начинается с //» мало: браузер молча выкидывает из адреса
 * табуляции и переводы строк, а «\» читает как «/». Поэтому «/<таб>/чужой»
 * на деле открывал «//чужой». Такие символы отвергаем целиком, а в конце
 * сверяем, что адрес и после разбора остаётся на этом сайте.
 */
const SELF = "https://floria.invalid";

export function safeRedirect(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  try {
    if (new URL(value, SELF).origin !== SELF) return fallback;
  } catch {
    return fallback;
  }
  return value;
}
