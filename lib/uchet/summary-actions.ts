"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaffAction } from "@/lib/auth/server";
import { isOwnerRole } from "@/lib/auth/roles";
import { getDefaultLocation } from "@/lib/uchet/queries";

// ================================================================
// Что владелец вписывает в «Сводке» руками (миграция 031). Только
// владельцы: в сводке выручка и прибыль.
// ================================================================

type Result = { success: true } | { success: false; error: string };

const fail = (error: string): Result => ({ success: false, error });

function refresh() {
  revalidatePath("/uchet/svodka");
}

/** Доход за год, которого нет ни в одной системе (в 2026 — январь–март, до Posiflora). */
export async function saveIncomeExtra(year: number, amount: number, note: string): Promise<Result> {
  const staff = await requireStaffAction(isOwnerRole);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return fail("Год не тот");
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) return fail("Сумма должна быть от 0");
  const { error } = await getSupabaseAdmin()
    .from("summary_income_extra")
    .upsert({ year, amount: Math.round(amount * 100) / 100, note: note.trim().slice(0, 200) || null, updated_at: new Date().toISOString(), updated_by: staff.id });
  if (error) return fail(`Не сохранилось: ${error.message}`);
  refresh();
  return { success: true };
}

/**
 * Название способа оплаты Posiflora. Её API отдаёт доли по способам без
 * названий, поэтому «48% — это карта» подписывает владелец. Пустое
 * название — убрать подпись.
 */
export async function savePosifloraPaymentName(methodId: string, title: string): Promise<Result> {
  await requireStaffAction(isOwnerRole);
  if (!/^[0-9a-f-]{36}$/i.test(methodId)) return fail("Способ не найден");
  const clean = title.trim().slice(0, 40);

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("pos_settings").select("posiflora_payment_names").eq("id", true).maybeSingle();
  if (error || !data) return fail(`Настройки: ${error?.message ?? "нет строки"}`);
  const names = { ...((data.posiflora_payment_names ?? {}) as Record<string, string>) };
  if (clean) names[methodId] = clean;
  else delete names[methodId];

  const { error: saveError } = await admin.from("pos_settings").update({ posiflora_payment_names: names, updated_at: new Date().toISOString() }).eq("id", true);
  if (saveError) return fail(`Не сохранилось: ${saveError.message}`);
  refresh();
  return { success: true };
}

/**
 * С какого дня считать выручку по Учёту. Только после запуска: пока есть
 * лишь «Тренировка», в Учёте нет настоящих продаж, и сводка показала бы
 * ноль вместо выручки.
 */
export async function setSummaryUchetSince(day: string | null): Promise<Result> {
  await requireStaffAction(isOwnerRole);
  if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail("Дата не та");

  if (day && (await getDefaultLocation()).isTraining) return fail("Учёт ещё не запущен — сначала запуск в справочниках склада");
  const { error } = await getSupabaseAdmin().from("pos_settings").update({ summary_uchet_since: day, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) return fail(`Не сохранилось: ${error.message}`);
  refresh();
  return { success: true };
}
