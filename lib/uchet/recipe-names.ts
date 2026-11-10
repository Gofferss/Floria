// ================================================================
// Названия букетов и состава для сайта (решение владельца 10.11.2026).
//
// Название начинается с «Букет из …» и называет главные цветы.
// Второстепенное — зелень, сухоцветы, стабилизированное — в название не
// идёт: «Букет из хризантемы бигуди и эвкалипта» → «Букет из хризантемы
// бигуди». Это видно в составе, а название остаётся коротким. Чтобы
// различать похожие букеты, у них есть маленькое название («Солнышко»).
//
// Позиции склада называются по-кассовому («ХРИЗАНТЕМА ГОЛОВА 300»,
// «СПРЕЙ МИКС 350»). Покупателю на сайте нужен человеческий состав:
// «Хризантема бигуди — 7 шт».
// ================================================================

/** Второстепенное: зелень, сухоцветы, стабилизированное. Начало слова в любом падеже. */
const SECONDARY =
  /^(эвкалипт|эвкалип|ковыл|лагурус|элеукодендрон|леукадендрон|стабилизированн|хелеборус|зелен|писташ|рускус|салал|аспидистр|хамелаци|гипсофил|статиц|сухоцвет|озатамнус|бруни)/i;

function isSecondary(phrase: string): boolean {
  return SECONDARY.test(phrase.trim());
}

/** Слово «Крымская роза» в студии пишут с большой буквы — как название, а не прилагательное. */
function lowerFirst(phrase: string): string {
  const p = phrase.trim();
  if (/^крымск/i.test(p)) return p.charAt(0).toUpperCase() + p.slice(1);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}`;
}

/** Опечатки, которые встречались в названиях. В JS \b не работает с кириллицей — граница руками. */
function fixTypos(s: string): string {
  return s.replace(/кустовой роза(?=[\s,.]|$)/gi, "кустовой розы");
}

/**
 * «Букет из Хризантемы бигуди, французской розы и эвкалипт» →
 * «Букет из хризантемы бигуди и французской розы».
 * Название не в виде «Букет из …» оставляем как есть — только пробелы.
 */
export function cleanBouquetTitle(raw: string): string {
  const title = fixTypos(raw.replace(/\s+/g, " ").trim());
  const m = title.match(/^букет из\s+(.+)$/i);
  if (!m) return title;
  let body = m[1];
  // Хвост «с эвкалиптом», «с ковылём» — тоже второстепенное.
  const withTail = body.split(/\s+с\s+(?=\S)/i);
  if (withTail.length > 1 && withTail.slice(1).every(isSecondary)) body = withTail[0];
  const parts = body
    .split(/\s*,\s*|\s+и\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const main = parts.filter((p) => !isSecondary(p));
  // Если второстепенным оказалось всё — лучше оставить как было, чем пустое название.
  if (main.length === 0) return title;
  return `Букет из ${joinList(main.map(lowerFirst))}`;
}

// ---------------------------------------------------------------
// Человеческие названия позиций для состава на сайте
// ---------------------------------------------------------------

const NAMES: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/УПАКОВК/i, "Упаковка"],
  [/ХРИЗ\S*\s+(ГОЛОВ|БИГУДИ)|БИГУДИ/i, "Хризантема бигуди"],
  [/ХРИЗ\S*.*РОМАШ/i, "Хризантема ромашковая"],
  [/ХРИЗ\S*\s+КУСТ|КУСТ\S*\s+ХРИЗ/i, "Хризантема кустовая"],
  [/ЭКСПЛО[ЕР]Р?.*МЕСТН/i, "Крымская роза Эксплоер"],
  [/ЭКСПЛО[ЕР]Р?/i, "Роза Эксплоер"],
  [/ПИНЧ АВАЛАНШ|ПИНК АВАЛАН/i, "Роза Пинк Аваланш"],
  [/СВИТ АВАЛАНШ/i, "Роза Свит Аваланш"],
  [/АВАЛАН[ШЖ]/i, "Роза Аваланш"],
  [/РЕД НАОМИ/i, "Роза Ред Наоми"],
  [/МИСС ПИГГИ/i, "Роза Мисс Пигги"],
  [/ГОТЧА/i, "Французская роза"],
  [/МАНДАЛА/i, "Французская роза Мандала"],
  [/СПРЕЙ|КУСТОВАЯ РОЗА/i, "Кустовая роза"],
  [/ДИАНТУС\s+(\S+)/i, (m) => `Диантус ${m[1].toLowerCase()}`],
  [/ГОРТЕНЗИЯ\s+(\S+)/i, (m) => `Гортензия ${m[1].toLowerCase()}`],
  [/ЭВКАЛИПТ/i, "Эвкалипт"],
  [/КОВЫЛ/i, "Ковыль"],
  [/Л?ЕУКАДЕНДРОН|ЛЕУКОДЕНДРОН/i, "Леукадендрон"],
];

/** Кассовое название → понятное покупателю. Неизвестное — без цен, размеров и поставщиков. */
export function humanItemName(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  for (const [re, name] of NAMES) {
    const m = t.match(re);
    if (m) return typeof name === "string" ? name : name(m);
  }
  // Без \b: с кириллицей он не работает, границы — пробелы и края строки.
  const cleaned = ` ${t} `
    .replace(/\s(ризван|зел[её]ный дом|юг агро|изет|амиль|бутон|местн\S*|уценка)(?=\s)/gi, " ")
    .replace(/\sпо\s+\d+\s*(руб\S*)?(?=\s)/gi, " ")
    .replace(/\s\d+\s*(см|cm|руб\S*)?(?=\s)/gi, " ")
    .replace(/[()«»"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : t;
}

/**
 * Состав для карточки на сайте: главные цветы по количеству, затем зелень,
 * упаковка — последней и без числа. Одинаковые по смыслу позиции
 * (хризантема по 250 и по 300) складываются.
 */
export function siteCompositionLines(items: { title: string; qty: number }[]): string[] {
  const sum = new Map<string, number>();
  for (const i of items) {
    const name = humanItemName(i.title);
    sum.set(name, (sum.get(name) ?? 0) + i.qty);
  }
  const fmt = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString("ru-RU", { maximumFractionDigits: 2 }));
  const entries = [...sum.entries()];
  const pack = entries.filter(([n]) => n === "Упаковка");
  const rest = entries.filter(([n]) => n !== "Упаковка");
  const main = rest.filter(([n]) => !isSecondary(n)).sort((a, b) => b[1] - a[1]);
  const green = rest.filter(([n]) => isSecondary(n)).sort((a, b) => b[1] - a[1]);
  return [...main.map(([n, q]) => `${n} — ${fmt(q)} шт`), ...green.map(([n, q]) => `${n} — ${fmt(q)} шт`), ...pack.map(() => "Упаковка")];
}

/** Сколько видов главных цветов — чтобы понять, монобукет это или сборный. */
export function mainFlowerKinds(items: { title: string }[]): number {
  const names = new Set(items.map((i) => humanItemName(i.title)).filter((n) => n !== "Упаковка" && !isSecondary(n)));
  return names.size;
}
