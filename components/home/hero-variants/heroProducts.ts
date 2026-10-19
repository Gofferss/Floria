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
 * Берём товары «с просветами» — не первые подряд, а равномерно по каталогу.
 * Подряд идущие карточки часто из одной съёмки: один фон, один ракурс, одни
 * цветы, и главный блок выглядит как брак печати.
 */
export async function getHeroPhotos(count: number): Promise<HeroPhoto[]> {
  const withPhoto = (await getProducts()).filter((p: Product) => p.images.length > 0);
  if (withPhoto.length === 0) return [];

  const step = Math.max(1, Math.floor(withPhoto.length / count));
  const picked: HeroPhoto[] = [];

  for (let i = 0; i < withPhoto.length && picked.length < count; i += step) {
    const p = withPhoto[i];
    picked.push({ slug: p.slug, name: p.name, price: p.basePrice, src: p.images[0] });
  }

  return picked;
}

/** «2 200 ₽» — узкие пробелы, чтобы цена не рвалась на перенос. */
export function formatPrice(value: number): string {
  return `${value.toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;
}
