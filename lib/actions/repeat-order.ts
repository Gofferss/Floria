"use server";

import { createSupabaseServerClient } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// «Повторить заказ» из личного кабинета.
//
// Цветы покупают циклично: та же мама, та же годовщина, тот же букет.
// Кнопка превращает три минуты оформления в одно нажатие.
//
// Почему это серверное действие, а не сборка корзины прямо в браузере из
// сохранённой истории: с прошлого раза цена могла измениться, а букет —
// исчезнуть из каталога. В корзину кладём СЕГОДНЯШНЕЕ состояние товара,
// а о том, чего больше нет, честно предупреждаем.
// ================================================================

export type RepeatItem = {
  id: string;
  productSlug: string;
  name: string;
  size: string;
  price: number;
  quantity: number;
  image?: string;
  availabilityMode: "in_stock" | "made_to_order";
};

export type RepeatResult =
  | { success: true; items: RepeatItem[]; unavailable: string[] }
  | { success: false; error: string };

export async function repeatOrder(orderId: string): Promise<RepeatResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Войдите в личный кабинет" };

  const supabaseAdmin = getSupabaseAdmin();

  // Заказ обязан принадлежать этому человеку. Проверяем на сервере, а не
  // полагаемся на то, что чужой номер заказа никто не подставит.
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, customer_id, customers!inner(auth_user_id)")
    .eq("id", orderId)
    .maybeSingle();

  const owner = (order as { customers?: { auth_user_id?: string } | { auth_user_id?: string }[] } | null)?.customers;
  const ownerId = Array.isArray(owner) ? owner[0]?.auth_user_id : owner?.auth_user_id;

  if (!order || ownerId !== user.id) {
    return { success: false, error: "Заказ не найден" };
  }

  const { data: orderItems } = await supabaseAdmin
    .from("order_items")
    .select("product_id, product_name, quantity")
    .eq("order_id", orderId);

  if (!orderItems || orderItems.length === 0) {
    return { success: false, error: "В этом заказе нечего повторить" };
  }

  const productIds = orderItems
    .map((row) => row.product_id as string | null)
    .filter((id): id is string => !!id);

  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id, slug, name, price, images, availability_mode")
    .in("id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("is_active", true);

  const byId = new Map((products ?? []).map((p) => [p.id as string, p]));

  const items: RepeatItem[] = [];
  const unavailable: string[] = [];

  for (const row of orderItems) {
    const product = row.product_id ? byId.get(row.product_id as string) : undefined;

    // Товар удалён, скрыт или заказ был оформлен до того, как появилась
    // связь с карточкой — повторить нечего, но скажем какой именно.
    if (!product) {
      unavailable.push(row.product_name as string);
      continue;
    }

    const images = Array.isArray(product.images) ? (product.images as string[]) : [];

    items.push({
      // Тот же формат ключа, что и в остальной корзине: слаг + размер.
      id: `${product.slug}__std`,
      productSlug: product.slug as string,
      name: product.name as string,
      size: "Стандарт",
      price: Number(product.price) || 0,
      quantity: Math.max(Number(row.quantity) || 1, 1),
      image: images[0],
      availabilityMode: product.availability_mode === "made_to_order" ? "made_to_order" : "in_stock",
    });
  }

  if (items.length === 0) {
    return { success: false, error: "Ни одного букета из этого заказа сейчас нет в каталоге" };
  }

  return { success: true, items, unavailable };
}
