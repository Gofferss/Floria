/**
 * Куда вернуть человека после входа — только на страницу этого же сайта.
 *
 * Адрес приходит из ссылки (?redirect=...), а ссылку может составить кто
 * угодно. Без проверки «https://чужой-сайт» или «//чужой-сайт» увёл бы
 * человека со страницы входа наружу — уже после того, как он ввёл код и
 * доверился странице. Разрешаем только путь от корня этого сайта.
 */
export function safeRedirect(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
