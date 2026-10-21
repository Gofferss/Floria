"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaffAction } from "@/lib/auth/server";
import { isOwnerRole } from "@/lib/auth/roles";

// ================================================================
// «Настройки»: правила кассы и её справочники. Только владельцы.
//
// Что намеренно нельзя:
//   * удалить способ оплаты или причину — на них ссылаются прошлые чеки
//     и движения денег; можно выключить;
//   * поменять у способа «наличные или нет», если им уже платили, — это
//     пересчитало бы ожидаемые наличные в прошлых сменах;
//   * поменять смысл причины (закупка, зарплата, возврат) — по нему
//     касса открывает приход, спрашивает, кому выдали, и ищет причину
//     для возврата при отмене заказа;
//   * выключить «Наличные» и последнюю причину каждого служебного смысла.
// ================================================================

type Result = { success: true } | { success: false; error: string };

const fail = (error: string): Result => ({ success: false, error });

async function owner() {
  return requireStaffAction(isOwnerRole);
}

function refresh() {
  revalidatePath("/uchet", "layout");
}

/** Скидка без подтверждения и можно ли продать букет без состава. */
export async function savePosRules(discountLimitPercent: number, compositionRequired: boolean): Promise<Result> {
  await owner();
  if (!Number.isFinite(discountLimitPercent) || discountLimitPercent < 0 || discountLimitPercent > 100) return fail("Скидка — от 0 до 100%");
  const { error } = await getSupabaseAdmin()
    .from("pos_settings")
    .update({ discount_limit_percent: Math.round(discountLimitPercent * 100) / 100, composition_required: !!compositionRequired, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) return fail(`Не сохранилось: ${error.message}`);
  refresh();
  return { success: true };
}

export async function savePaymentMethod(input: { code: string | null; title: string; isCash: boolean; isActive: boolean }): Promise<Result> {
  await owner();
  const title = input.title.trim().slice(0, 30);
  if (!title) return fail("Напишите название");
  const admin = getSupabaseAdmin();
  const { data: all, error } = await admin.from("pos_payment_methods").select("code, title, is_cash, is_active, sort");
  if (error) return fail(error.message);
  const list = all ?? [];
  if (list.some((m) => m.code !== input.code && m.title.toLowerCase() === title.toLowerCase())) return fail("Такой способ уже есть");

  if (!input.code) {
    const sort = Math.max(0, ...list.map((m) => m.sort)) + 10;
    const code = `m${Date.now().toString(36)}`;
    const { error: insError } = await admin.from("pos_payment_methods").insert({ code, title, is_cash: !!input.isCash, is_active: true, sort });
    if (insError) return fail(`Не сохранилось: ${insError.message}`);
    refresh();
    return { success: true };
  }

  const current = list.find((m) => m.code === input.code);
  if (!current) return fail("Способ не найден");
  if (!input.isActive && current.code === "cash") return fail("«Наличные» не выключаются: на них стоит пересчёт кассы смены");
  if (!input.isActive && current.is_active && list.filter((m) => m.is_active).length <= 1) return fail("Хотя бы один способ оплаты должен остаться");
  if (input.isCash !== current.is_cash) {
    const { count, error: usedError } = await admin.from("pos_payments").select("id", { count: "exact", head: true }).eq("method", current.code);
    if (usedError) return fail(usedError.message);
    if (count) return fail("Этим способом уже платили — «наличные или нет» не меняется. Заведите новый способ");
  }
  const { error: updError } = await admin.from("pos_payment_methods").update({ title, is_cash: !!input.isCash, is_active: !!input.isActive }).eq("code", current.code);
  if (updError) return fail(`Не сохранилось: ${updError.message}`);
  refresh();
  return { success: true };
}

const NEW_KINDS: Record<"in" | "out", string[]> = { in: ["other"], out: ["other", "purchase", "salary"] };
const SERVICE_KINDS = ["purchase", "salary", "collection", "refund"];

export async function saveCashReason(input: { id: string | null; direction: "in" | "out"; title: string; kind: string; isActive: boolean }): Promise<Result> {
  await owner();
  const title = input.title.trim().slice(0, 40);
  if (!title) return fail("Напишите причину");
  if (input.direction !== "in" && input.direction !== "out") return fail("Внесение или изъятие?");
  const admin = getSupabaseAdmin();
  const { data: all, error } = await admin.from("pos_cash_reasons").select("id, direction, title, kind, is_active, sort");
  if (error) return fail(error.message);
  const list = all ?? [];
  if (list.some((r) => r.id !== input.id && r.direction === input.direction && r.title.toLowerCase() === title.toLowerCase())) return fail("Такая причина уже есть");

  if (!input.id) {
    if (!NEW_KINDS[input.direction].includes(input.kind)) return fail("Такой вид причины выбрать нельзя");
    const sort = Math.max(0, ...list.filter((r) => r.direction === input.direction).map((r) => r.sort)) + 10;
    const { error: insError } = await admin.from("pos_cash_reasons").insert({ direction: input.direction, title, kind: input.kind, sort });
    if (insError) return fail(`Не сохранилось: ${insError.message}`);
    refresh();
    return { success: true };
  }

  const current = list.find((r) => r.id === input.id);
  if (!current) return fail("Причина не найдена");
  if (!input.isActive && current.is_active && SERVICE_KINDS.includes(current.kind)) {
    const others = list.filter((r) => r.id !== current.id && r.is_active && r.kind === current.kind && r.direction === current.direction);
    if (!others.length) return fail("Это последняя причина такого вида — без неё касса не сможет провести закупку, зарплату, инкассацию или возврат");
  }
  const { error: updError } = await admin.from("pos_cash_reasons").update({ title, is_active: !!input.isActive }).eq("id", current.id);
  if (updError) return fail(`Не сохранилось: ${updError.message}`);
  refresh();
  return { success: true };
}
