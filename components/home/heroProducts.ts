import { getProducts, type Product } from "@/lib/products";

// ================================================================
// Фотографии для главного блока.
//
// Берём их из каталога, а не кладём отдельными файлами в /public: витрина
// студии меняется, и прибитая к коду картинка через месяц показывает то,
// чего уже не собирают. Заодно с фото приезжают название и цена — главный
// блок получается кликабельным, а не декоративным.
// ================================================================

export type HeroPhoto = {
  slug: string;
  name: string;
  price: number;
  src: string;
};

/**
 * Запас фотографий для окон главного блока: на каждое окно — несколько
 * букетов, а какой из них показать, решает браузер посетителя при каждом
 * заходе (HeroShuffle). Главная собирается заранее, один раз на всех, —
 * выбирать на сервере значило бы собирать её на каждого и терять скорость.
 *
 * Каталог делится на столько частей, сколько окон, и каждое окно берёт
 * кандидатов только из своей части, «с просветами». Подряд идущие карточки
 * часто из одной съёмки: один фон, один ракурс, одни цветы, — и если бы
 * случай выбирал из всего каталога, рано или поздно в ряд встали бы три
 * почти одинаковых фото, а это выглядит как брак печати.
 *
 * Только букеты: поштучная срезка с ценой «за штуку» в витрине из трёх
 * фото читалась бы как цена букета.
 */
export async function getHeroPool(slots: number, perSlot: number): Promise<HeroPhoto[][]> {
  const bouquets = (await getProducts()).filter((p: Product) => p.images.length > 0 && p.pricingMode === "bouquet");
  const pool: HeroPhoto[][] = [];

  for (let s = 0; s < slots; s++) {
    const part = bouquets.slice(Math.floor((s * bouquets.length) / slots), Math.floor(((s + 1) * bouquets.length) / slots));
    const count = Math.min(perSlot, part.length);
    if (count === 0) continue;
    const picked: HeroPhoto[] = [];
    for (let i = 0; i < count; i++) {
      const p = part[Math.floor((i * part.length) / count)];
      picked.push({ slug: p.slug, name: p.name, price: p.basePrice, src: p.images[0] });
    }
    pool.push(picked);
  }

  return pool;
}

/** «2 200 ₽» — узкие пробелы, чтобы цена не рвалась на перенос. */
export function formatPrice(value: number): string {
  return `${value.toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;
}
