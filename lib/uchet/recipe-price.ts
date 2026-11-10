// ================================================================
// Цена рецепта — одна формула для кассы, страницы рецептов и сайта.
//
// По составу: сумма цен стеблей по прайсу склада. Поменяли цену розы —
// поменялась цена каждого букета, где она есть. Своя цена — как есть.
// Позиции без цены не дают ноль молча: их список возвращается, чтобы
// экран предупредил, что цена по составу занижена.
// ================================================================

export type RecipeLine = { itemId: string; qty: number };

export type RecipePriceInput = {
  priceMode: "composition" | "fixed";
  fixedPrice: number | null;
  items: RecipeLine[];
};

export type RecipePrice = {
  price: number;
  /** Сумма по составу — даже при своей цене, для сравнения. */
  composition: number;
  /** Позиции без цены: по составу посчитано без них. */
  unpriced: string[];
};

export function recipePrice(r: RecipePriceInput, priceOf: (itemId: string) => number | null | undefined): RecipePrice {
  let composition = 0;
  const unpriced: string[] = [];
  for (const l of r.items) {
    const p = priceOf(l.itemId);
    if (p === null || p === undefined || !(p > 0)) unpriced.push(l.itemId);
    else composition += p * l.qty;
  }
  composition = Math.round(composition * 100) / 100;
  const price = r.priceMode === "fixed" && r.fixedPrice !== null ? r.fixedPrice : composition;
  return { price, composition, unpriced };
}
