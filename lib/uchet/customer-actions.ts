"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaffAction } from "@/lib/auth/server";
import { canUseUchetWork, isOwnerRole } from "@/lib/auth/roles";
import { toE164RussianPhone } from "@/lib/phone-mask";
import { MINUTE, jsonRows, posifloraCached } from "@/lib/posiflora/cached";
import { getCustomerHistory, type Purchase } from "@/lib/uchet/customers";

// ================================================================
// Клиенты: завести на кассе, поправить карточку, перенести из Posiflora.
//
// Касса заводит клиента ТОЛЬКО у нас. Сайт при заказе заодно создаёт
// клиента в Posiflora (lib/customer-sync.ts), но касса так не делает:
// пробные продажи в «Тренировке» засорили бы настоящую Posiflora. Связь
// с Posiflora появится сама, когда человек закажет на сайте или войдёт.
// ================================================================

type Result<T = undefined> = { success: true; data: T } | { success: false; error: string };

const fail = <T,>(error: string): Result<T> => ({ success: false, error });

export type NewCustomer = { id: string; name: string | null; phone: string; bonusBalance: number };

/** С кассы: телефон обязателен, имя — по желанию. Уже есть — вернём того же. */
export async function createCustomerAtTill(phoneRaw: string, nameRaw: string): Promise<Result<NewCustomer>> {
  await requireStaffAction(canUseUchetWork);
  const phone = toE164RussianPhone(phoneRaw);
  if (!phone) return fail("Нужен российский номер: +7 и 10 цифр");
  const name = nameRaw.trim().slice(0, 80) || null;
  const admin = getSupabaseAdmin();

  const { data: existing, error: findError } = await admin.from("customers").select("id, full_name, phone, bonus_balance").eq("phone", phone).maybeSingle();
  if (findError) return fail(findError.message);
  if (existing) return { success: true, data: { id: existing.id, name: existing.full_name, phone: existing.phone, bonusBalance: Number(existing.bonus_balance) || 0 } };

  const { data: created, error } = await admin.from("customers").insert({ phone, full_name: name }).select("id, full_name, phone").single();
  if (error) {
    // Гонка с сайтом или вторым айпадом — карточка уже появилась.
    if (error.code === "23505") {
      const { data: winner } = await admin.from("customers").select("id, full_name, phone, bonus_balance").eq("phone", phone).maybeSingle();
      if (winner) return { success: true, data: { id: winner.id, name: winner.full_name, phone: winner.phone, bonusBalance: Number(winner.bonus_balance) || 0 } };
    }
    return fail(`Не сохранилось: ${error.message}`);
  }
  return { success: true, data: { id: created.id, name: created.full_name, phone: created.phone, bonusBalance: 0 } };
}

/** Карточка клиента: имя, день рождения, заметка. Телефон не меняется — по нему клиент входит на сайт. */
export async function updateCustomer(id: string, input: { name: string; birthday: string | null; notes: string }): Promise<Result> {
  await requireStaffAction(isOwnerRole);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Клиент не найден");
  if (input.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(input.birthday)) return fail("Дата рождения не та");
  const { error } = await getSupabaseAdmin()
    .from("customers")
    .update({ full_name: input.name.trim().slice(0, 80) || null, birthday: input.birthday || null, notes: input.notes.trim().slice(0, 1000) || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail(`Не сохранилось: ${error.message}`);
  revalidatePath("/uchet/klienty");
  return { success: true, data: undefined };
}

export async function loadCustomerHistory(id: string): Promise<Result<Purchase[]>> {
  await requireStaffAction(isOwnerRole);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Клиент не найден");
  try {
    return { success: true, data: await getCustomerHistory(id) };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Не загрузилось");
  }
}

/**
 * Перенести клиентов Posiflora, которых у нас нет: имя, телефон,
 * день рождения, связь и баланс бонусов. В Posiflora ничего не пишется.
 */
export async function importPosifloraCustomers(ids: string[]): Promise<Result<{ added: number }>> {
  await requireStaffAction(isOwnerRole);
  if (!Array.isArray(ids) || !ids.length || ids.length > 200) return fail("Некого переносить");
  const res = await posifloraCached("/customers?page[size]=100", 10 * MINUTE);
  const admin = getSupabaseAdmin();
  const { data: ours, error } = await admin.from("customers").select("phone, posiflora_client_id");
  if (error) return fail(error.message);
  const linked = new Set((ours ?? []).map((c) => c.posiflora_client_id).filter(Boolean));
  const phones = new Set((ours ?? []).map((c) => c.phone));

  const rows = jsonRows(res)
    .filter((c) => ids.includes(c.id) && !linked.has(c.id))
    .map((c) => {
      const local = String(c.attributes?.phone ?? "").replace(/\D/g, "");
      const phone = toE164RussianPhone(`+${c.attributes?.countryCode ?? 7}${local}`);
      const birthday = String(c.attributes?.birthday ?? "").slice(0, 10);
      return {
        phone,
        full_name: String(c.attributes?.title ?? "").trim() || null,
        birthday: /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : null,
        posiflora_client_id: c.id,
        bonus_balance: Number(c.attributes?.currentPoints) || 0,
        bonus_balance_synced_at: new Date().toISOString(),
      };
    })
    .filter((r): r is typeof r & { phone: string } => !!r.phone && !phones.has(r.phone));
  if (!rows.length) return fail("Эти клиенты уже есть у нас или без телефона");
  const { error: insError } = await admin.from("customers").insert(rows);
  if (insError) return fail(`Не сохранилось: ${insError.message}`);
  revalidatePath("/uchet/klienty");
  return { success: true, data: { added: rows.length } };
}
