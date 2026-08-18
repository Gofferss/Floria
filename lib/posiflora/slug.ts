// Нужен из-за печального опыта: Шаг 3 этого проекта уже ловил баг на
// кириллической букве в слаге товара, вбитом вручную. Здесь риск выше —
// слаги для НОВЫХ товаров генерируются автоматически из русскоязычных
// названий из Posiflora, руками их никто не проверит.

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function transliterate(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join("");
}

/**
 * Слаг для автоматически синхронизированного товара: транслитерация +
 * ASCII-safe очистка + короткий суффикс от posiflora id. Суффикс —
 * не эстетика, а гарантия уникальности: два товара Posiflora с похожими
 * названиями ("Розы красные" / "Розы красные (микс)") иначе легко дают
 * одинаковый слаг, а slug у нас unique not null.
 *
 * Слаг генерируется ОДИН РАЗ, при первом появлении товара — при
 * последующих синках существующий слаг не трогаем: смена слага ломает
 * уже расшаренные/проиндексированные ссылки на товар.
 */
export function generateProductSlug(title: string, posifloraId: string): string {
  const base = transliterate(title)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const suffix = posifloraId.replace(/-/g, "").slice(0, 6);

  return `${base || "tovar"}-${suffix}`;
}
