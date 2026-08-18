"use server";

import { revalidatePath } from "next/cache";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

export type PromoCodeInput = {
  code: string;
  description: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  minOrderAmount: number;
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
};

export type AdminPromoCode = PromoCodeInput & { id: string; timesUsed: number; createdAt: string };

function validatePromoInput(input: PromoCodeInput): string | null {
  if (!input.code.trim()) return "Укажите код";
  if (!/^[A-ZА-Я0-9_-]+$/i.test(input.code.trim())) {
    return "Код может содержать только буквы, цифры, дефис и подчёркивание";
  }
  if (!Number.isFinite(input.discountValue) || input.discountValue <= 0) {
    return "Укажите размер скидки больше нуля";
  }
  if (input.discountType === "percent" && input.discountValue > 100) {
    return "Процент скидки не может быть больше 100";
  }
  if (input.minOrderAmount < 0) return "Минимальная сумма заказа не может быть отрицательной";
  if (input.maxUses !== null && input.maxUses <= 0) return "Лимит использований должен быть больше нуля";
  if (input.maxUsesPerCustomer !== null && input.maxUsesPerCustomer <= 0) {
    return "Лимит на клиента должен быть больше нуля";
  }
  if (input.validFrom && input.validUntil && new Date(input.validFrom) > new Date(input.validUntil)) {
    return "Дата начала не может быть позже даты окончания";
  }
  return null;
}

export async function listPromoCodesAdmin(): Promise<AdminPromoCode[]> {
  await requireStaff();

  const { data, error } = await getSupabaseAdmin()
    .from("promo_codes")
    .select(
      "id, code, description, discount_type, discount_value, min_order_amount, max_uses, max_uses_per_customer, valid_from, valid_until, is_active, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listPromoCodesAdmin]", error.message);
    return [];
  }

  const ids = (data ?? []).map((row) => row.id);
  const usageByCode = new Map<string, number>();
  if (ids.length > 0) {
    const { data: redemptions } = await getSupabaseAdmin()
      .from("promo_code_redemptions")
      .select("promo_code_id")
      .in("promo_code_id", ids);
    for (const row of redemptions ?? []) {
      usageByCode.set(row.promo_code_id, (usageByCode.get(row.promo_code_id) ?? 0) + 1);
    }
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    description: row.description ?? "",
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    minOrderAmount: Number(row.min_order_amount),
    maxUses: row.max_uses,
    maxUsesPerCustomer: row.max_uses_per_customer,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    isActive: row.is_active,
    timesUsed: usageByCode.get(row.id) ?? 0,
    createdAt: row.created_at,
  }));
}

export async function getPromoCodeForEdit(id: string): Promise<AdminPromoCode | null> {
  await requireStaff();

  const { data, error } = await getSupabaseAdmin()
    .from("promo_codes")
    .select(
      "id, code, description, discount_type, discount_value, min_order_amount, max_uses, max_uses_per_customer, valid_from, valid_until, is_active, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const { count } = await getSupabaseAdmin()
    .from("promo_code_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("promo_code_id", id);

  return {
    id: data.id,
    code: data.code,
    description: data.description ?? "",
    discountType: data.discount_type,
    discountValue: Number(data.discount_value),
    minOrderAmount: Number(data.min_order_amount),
    maxUses: data.max_uses,
    maxUsesPerCustomer: data.max_uses_per_customer,
    validFrom: data.valid_from,
    validUntil: data.valid_until,
    isActive: data.is_active,
    timesUsed: count ?? 0,
    createdAt: data.created_at,
  };
}

function buildRow(input: PromoCodeInput) {
  return {
    code: input.code.trim().toUpperCase(),
    description: input.description.trim() || null,
    discount_type: input.discountType,
    discount_value: input.discountValue,
    min_order_amount: input.minOrderAmount,
    max_uses: input.maxUses,
    max_uses_per_customer: input.maxUsesPerCustomer,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
    is_active: input.isActive,
  };
}

export async function createPromoCode(input: PromoCodeInput): Promise<ActionResult<{ id: string }>> {
  await requireStaff();

  const validationError = validatePromoInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data, error } = await getSupabaseAdmin()
    .from("promo_codes")
    .insert(buildRow(input))
    .select("id")
    .single();

  if (error || !data) {
    console.error("[createPromoCode]", error?.message);
    if (error?.code === "23505") return { success: false, error: "Такой промокод уже существует" };
    return { success: false, error: "Не удалось сохранить промокод" };
  }

  revalidatePath("/admin/promo-codes");
  return { success: true, data: { id: data.id } };
}

export async function updatePromoCode(
  id: string,
  input: PromoCodeInput
): Promise<ActionResult<{ id: string }>> {
  await requireStaff();

  const validationError = validatePromoInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data, error } = await getSupabaseAdmin()
    .from("promo_codes")
    .update(buildRow(input))
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    console.error("[updatePromoCode]", error?.message);
    if (error?.code === "23505") return { success: false, error: "Такой промокод уже существует" };
    return { success: false, error: "Не удалось сохранить промокод" };
  }

  revalidatePath("/admin/promo-codes");
  return { success: true, data: { id: data.id } };
}

export async function togglePromoCodeActive(id: string, isActive: boolean): Promise<ActionResult<null>> {
  await requireStaff();

  const { error } = await getSupabaseAdmin().from("promo_codes").update({ is_active: isActive }).eq("id", id);

  if (error) {
    console.error("[togglePromoCodeActive]", error.message);
    return { success: false, error: "Не удалось изменить статус промокода" };
  }

  revalidatePath("/admin/promo-codes");
  return { success: true, data: null };
}
