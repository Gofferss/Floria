import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Промокоды — сайтовая сущность (в Посифлоре аналога нет, см.
// migrations/008_promo_codes_and_stories.sql). Скидку по коду просто
// вычитаем из total_amount заказа, как и бонусы.
//
// Валидация ВСЕГДА идёт на сервере — и на этапе "проверить код на
// странице оформления" (app/api/promo/validate), и повторно на этапе
// "создать заказ" (app/api/orders), чтобы клиент не мог заранее
// проверить код с одной суммой, а на оплату отправить другую (та же
// причина, по которой цены товаров в /api/orders пересчитываются
// заново, а не берутся из тела запроса).
// ================================================================

export type PromoValidationResult =
  | { valid: true; promoCodeId: string; discountAmount: number }
  | { valid: false; error: string };

type PromoCodeRow = {
  id: string;
  discount_type: "percent" | "fixed";
  discount_value: number | string;
  min_order_amount: number | string;
  max_uses: number | null;
  max_uses_per_customer: number | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
};

export async function validatePromoCode(
  rawCode: string,
  customerPhone: string,
  itemsTotal: number
): Promise<PromoValidationResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { valid: false, error: "Введите промокод" };

  const supabaseAdmin = getSupabaseAdmin();

  const { data: promo, error } = await supabaseAdmin
    .from("promo_codes")
    .select(
      "id, discount_type, discount_value, min_order_amount, max_uses, max_uses_per_customer, valid_from, valid_until, is_active"
    )
    .eq("code", code)
    .maybeSingle<PromoCodeRow>();

  if (error) {
    console.error("[validatePromoCode]", error.message);
    return { valid: false, error: "Не удалось проверить промокод, попробуйте ещё раз" };
  }
  if (!promo || !promo.is_active) {
    return { valid: false, error: "Такого промокода нет или он больше не действует" };
  }

  const now = Date.now();
  if (promo.valid_from && new Date(promo.valid_from).getTime() > now) {
    return { valid: false, error: "Промокод ещё не начал действовать" };
  }
  if (promo.valid_until && new Date(promo.valid_until).getTime() < now) {
    return { valid: false, error: "Срок действия промокода истёк" };
  }

  const minOrderAmount = Number(promo.min_order_amount);
  if (itemsTotal < minOrderAmount) {
    return { valid: false, error: `Промокод действует для заказа от ${minOrderAmount} ₽` };
  }

  if (promo.max_uses !== null) {
    const { count, error: countError } = await supabaseAdmin
      .from("promo_code_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("promo_code_id", promo.id);
    if (countError) {
      console.error("[validatePromoCode] max_uses count", countError.message);
      return { valid: false, error: "Не удалось проверить промокод, попробуйте ещё раз" };
    }
    if ((count ?? 0) >= promo.max_uses) {
      return { valid: false, error: "Промокод больше не действует — лимит использований исчерпан" };
    }
  }

  if (promo.max_uses_per_customer !== null) {
    const { count, error: countError } = await supabaseAdmin
      .from("promo_code_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("promo_code_id", promo.id)
      .eq("customer_phone", customerPhone);
    if (countError) {
      console.error("[validatePromoCode] per-customer count", countError.message);
      return { valid: false, error: "Не удалось проверить промокод, попробуйте ещё раз" };
    }
    if ((count ?? 0) >= promo.max_uses_per_customer) {
      return { valid: false, error: "Вы уже использовали этот промокод" };
    }
  }

  const discountValue = Number(promo.discount_value);
  const rawDiscount = promo.discount_type === "percent" ? itemsTotal * (discountValue / 100) : discountValue;
  // Скидка не может увеличить сумму заказа или уйти в минус.
  const discountAmount = Math.min(Math.round(rawDiscount), itemsTotal);

  return { valid: true, promoCodeId: promo.id, discountAmount };
}

export async function recordPromoCodeRedemption(
  promoCodeId: string,
  orderId: string,
  customerPhone: string,
  discountAmount: number
): Promise<void> {
  const { error } = await getSupabaseAdmin().from("promo_code_redemptions").insert({
    promo_code_id: promoCodeId,
    order_id: orderId,
    customer_phone: customerPhone,
    discount_amount: discountAmount,
  });
  if (error) {
    console.error("[recordPromoCodeRedemption]", error.message);
  }
}
