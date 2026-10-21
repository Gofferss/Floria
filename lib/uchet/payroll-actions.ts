"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaffAction } from "@/lib/auth/server";
import { isOwnerRole } from "@/lib/auth/roles";
import { posifloraCached, jsonRows, MINUTE } from "@/lib/posiflora/cached";
import type { PayPart } from "@/lib/uchet/pay-parts";

// ================================================================
// Действия раздела «Зарплата» (миграция 032). Только владельцы: в нём
// чужие деньги. Схема пишется одной функцией базы (hr_set_pay_scheme),
// чтобы «закрыть старое и записать новое» не разошлось на полпути.
// ================================================================

type Result = { success: true } | { success: false; error: string };

const fail = (error: string): Result => ({ success: false, error });
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function owner() {
  return requireStaffAction(isOwnerRole);
}

function refresh() {
  revalidatePath("/uchet/lyudi", "layout");
}

function cleanPart(p: PayPart): PayPart | string {
  switch (p.kind) {
    case "monthly":
    case "per_shift":
    case "per_bouquet":
    case "per_delivery": {
      const amount = Number(p.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return "Сумма должна быть больше нуля";
      return { kind: p.kind, amount: Math.round(amount * 100) / 100, percent: null, base: null };
    }
    case "sales_percent": {
      const percent = Number(p.percent);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return "Процент — от 0 до 100";
      if (!p.base || !["own", "shift_days", "store"].includes(p.base)) return "Выберите, от каких продаж процент";
      return { kind: p.kind, amount: null, percent: Math.round(percent * 100) / 100, base: p.base };
    }
    default:
      return "Неизвестная часть схемы";
  }
}

/** Новая схема человека с даты. Пустой список — с этой даты без оплаты. */
export async function setPayScheme(employeeId: string, from: string, parts: PayPart[]): Promise<Result> {
  const staff = await owner();
  if (!isUuid(employeeId)) return fail("Человек не найден");
  if (!isDay(from)) return fail("Укажите, с какого дня действует схема");
  if (!Array.isArray(parts) || parts.length > 10) return fail("Частей схемы слишком много");
  const clean: PayPart[] = [];
  for (const p of parts) {
    const c = cleanPart(p);
    if (typeof c === "string") return fail(c);
    clean.push(c);
  }
  const { error } = await getSupabaseAdmin().rpc("hr_set_pay_scheme", { p_employee: employeeId, p_from: from, p_rules: clean, p_staff: staff.id });
  if (error) return fail(`Не сохранилось: ${error.message}`);
  refresh();
  return { success: true };
}

/** Отметка табеля рукой владельца: работал / не работал. Перекрывает смены Posiflora и вход по PIN. */
export async function setWorkDay(employeeId: string, day: string, worked: boolean): Promise<Result> {
  const staff = await owner();
  if (!isUuid(employeeId) || !isDay(day)) return fail("День не тот");
  const { error } = await getSupabaseAdmin()
    .from("hr_work_days")
    .upsert({ employee_id: employeeId, day, worked, source: "manual", updated_at: new Date().toISOString(), updated_by: staff.id });
  if (error) return fail(`Не сохранилось: ${error.message}`);
  refresh();
  return { success: true };
}

/** Премия (+) или удержание (−) за месяц — всегда с причиной. */
export async function addAdjustment(employeeId: string, month: string, amount: number, comment: string): Promise<Result> {
  const staff = await owner();
  if (!isUuid(employeeId) || !/^\d{4}-\d{2}$/.test(month)) return fail("Месяц не тот");
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10_000_000) return fail("Сумма не может быть нулём");
  if (!comment.trim()) return fail("Напишите, за что");
  const { error } = await getSupabaseAdmin()
    .from("hr_pay_adjustments")
    .insert({ employee_id: employeeId, month: `${month}-01`, amount: Math.round(amount * 100) / 100, comment: comment.trim().slice(0, 200), created_by: staff.id });
  if (error) return fail(`Не сохранилось: ${error.message}`);
  refresh();
  return { success: true };
}

export async function deleteAdjustment(id: string): Promise<Result> {
  await owner();
  if (!isUuid(id)) return fail("Запись не найдена");
  const { error } = await getSupabaseAdmin().from("hr_pay_adjustments").delete().eq("id", id);
  if (error) return fail(`Не удалилось: ${error.message}`);
  refresh();
  return { success: true };
}

/** Выдача мимо кассы Учёта: картой, переводом, наличными до запуска. */
export async function addPayout(employeeId: string, paidOn: string, amount: number, method: string, comment: string): Promise<Result> {
  const staff = await owner();
  if (!isUuid(employeeId) || !isDay(paidOn)) return fail("Дата не та");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return fail("Сумма должна быть больше нуля");
  if (!["cash", "card", "transfer", "other"].includes(method)) return fail("Как выдали?");
  const { error } = await getSupabaseAdmin()
    .from("hr_payouts")
    .insert({ employee_id: employeeId, paid_on: paidOn, amount: Math.round(amount * 100) / 100, method, comment: comment.trim().slice(0, 200) || null, created_by: staff.id });
  if (error) return fail(`Не сохранилось: ${error.message}`);
  refresh();
  return { success: true };
}

export async function deletePayout(id: string): Promise<Result> {
  await owner();
  if (!isUuid(id)) return fail("Запись не найдена");
  const { error } = await getSupabaseAdmin().from("hr_payouts").delete().eq("id", id);
  if (error) return fail(`Не удалилось: ${error.message}`);
  refresh();
  return { success: true };
}

async function workerNames(): Promise<Map<string, { first: string; full: string }>> {
  const res = await posifloraCached("/workers?page[size]=100", 60 * MINUTE);
  return new Map(
    jsonRows(res).map((w) => {
      const first = String(w.attributes?.firstName ?? "").trim();
      const full = [first, String(w.attributes?.lastName ?? "").trim()].filter(Boolean).join(" ") || "Без имени";
      return [w.id, { first: first || full, full }];
    })
  );
}

/** Связать человека с сотрудником Posiflora (или снять связь). */
export async function linkPosifloraWorker(employeeId: string, workerId: string | null): Promise<Result> {
  await owner();
  if (!isUuid(employeeId)) return fail("Человек не найден");
  if (workerId !== null && !(await workerNames()).has(workerId)) return fail("Такого сотрудника в Posiflora нет");
  const { error } = await getSupabaseAdmin().from("hr_employees").update({ posiflora_worker_id: workerId }).eq("id", employeeId);
  if (error) return fail(error.message.includes("hr_employees_posiflora_worker") ? "Этот сотрудник Posiflora уже связан с другим человеком" : `Не сохранилось: ${error.message}`);
  refresh();
  return { success: true };
}

/**
 * Завести людей из Posiflora — без PIN: на айпаде они не появятся, пока
 * владелец не задаст PIN в «Людях». Должность — флорист, её можно сменить.
 */
export async function addFromPosiflora(workerIds: string[]): Promise<Result> {
  await owner();
  if (!Array.isArray(workerIds) || !workerIds.length || workerIds.length > 50) return fail("Некого добавлять");
  const names = await workerNames();
  const admin = getSupabaseAdmin();
  const { data: linked, error: readError } = await admin.from("hr_employees").select("posiflora_worker_id").not("posiflora_worker_id", "is", null);
  if (readError) return fail(readError.message);
  const taken = new Set((linked ?? []).map((r) => r.posiflora_worker_id));
  const rows = workerIds
    .filter((id) => names.has(id) && !taken.has(id))
    .map((id) => ({ full_name: names.get(id)!.full, short_name: names.get(id)!.first, position: "florist", posiflora_worker_id: id }));
  if (!rows.length) return fail("Эти люди уже есть в Учёте");
  const { error } = await admin.from("hr_employees").insert(rows);
  if (error) return fail(`Не сохранилось: ${error.message}`);
  refresh();
  return { success: true };
}
