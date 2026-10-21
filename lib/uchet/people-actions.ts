"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaffAction } from "@/lib/auth/server";
import { canEnterUchet, isOwnerRole, isStaffRole } from "@/lib/auth/roles";
import { hashPin, pinProblem } from "@/lib/uchet/pin";
import { signInEmployee, signOutEmployee, type PinResult } from "@/lib/uchet/employee";
import { POSITIONS, type Position } from "@/lib/uchet/positions";

// ================================================================
// Сотрудники и входы. Менять их может только владелец: это ключи от
// всего учёта. Проверка — здесь, в каждом действии, а не скрытой кнопкой.
// ================================================================

type Result<T = undefined> = { success: true; data: T } | { success: false; error: string };

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function done() {
  revalidatePath("/uchet", "layout");
}

// ---------------------------------------------------------------
// Кто работает за планшетом
// ---------------------------------------------------------------

export async function switchEmployee(employeeId: string, pin: string): Promise<PinResult> {
  await requireStaffAction(canEnterUchet);
  const result = await signInEmployee(employeeId, pin);
  if (result.success) done();
  return result;
}

export async function leaveEmployee(): Promise<void> {
  await requireStaffAction(canEnterUchet);
  await signOutEmployee();
  done();
}

// ---------------------------------------------------------------
// Люди
// ---------------------------------------------------------------

export type EmployeeInput = {
  id?: string;
  fullName: string;
  shortName: string;
  position: Position;
  canApprove: boolean;
  staffId: string | null;
  isActive: boolean;
  /** Новый PIN — только если его меняют. Пусто — оставить прежний. */
  pin?: string;
};

export async function saveEmployee(input: EmployeeInput): Promise<Result<{ id: string }>> {
  await requireStaffAction(isOwnerRole);

  const fullName = clean(input.fullName);
  const shortName = clean(input.shortName) || fullName.split(" ")[0];
  if (!fullName) return { success: false, error: "Укажите имя" };
  if (!POSITIONS.includes(input.position)) return { success: false, error: "Неизвестная должность" };

  const row: Record<string, unknown> = {
    full_name: fullName,
    short_name: shortName,
    position: input.position,
    can_approve: input.canApprove,
    staff_id: input.staffId || null,
    is_active: input.isActive,
  };

  const pin = (input.pin ?? "").trim();
  if (pin) {
    const problem = pinProblem(pin);
    if (problem) return { success: false, error: problem };
    row.pin_hash = hashPin(pin);
    row.pin_failed = 0;
    row.pin_locked_until = null;
  } else if (!input.id) {
    return { success: false, error: "Задайте PIN из 4 цифр — без него человек не войдёт" };
  }

  const admin = getSupabaseAdmin();
  const { data, error } = input.id
    ? await admin.from("hr_employees").update(row).eq("id", input.id).select("id").maybeSingle()
    : await admin.from("hr_employees").insert(row).select("id").maybeSingle();

  if (error || !data) {
    const takenLogin = error?.message?.includes("staff_id");
    return { success: false, error: takenLogin ? "Этот вход уже привязан к другому человеку" : "Не удалось сохранить сотрудника" };
  }
  done();
  return { success: true, data: { id: data.id } };
}

// ---------------------------------------------------------------
// Входы
// ---------------------------------------------------------------

export type AccountInput = {
  fullName: string;
  email: string;
  password: string;
  role: string;
};

function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Пароль — не короче 8 символов";
  if (!/\d/.test(password) || !/[^\d]/.test(password)) return "В пароле нужны и буквы, и цифры";
  return null;
}

export async function createAccount(input: AccountInput): Promise<Result<{ id: string }>> {
  await requireStaffAction(isOwnerRole);

  const fullName = clean(input.fullName);
  const email = clean(input.email).toLowerCase();
  if (!fullName) return { success: false, error: "Укажите, чей это вход: «Магазин», «Курьер Саша»" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { success: false, error: "Почта указана неверно" };
  if (!isStaffRole(input.role)) return { success: false, error: "Неизвестная роль" };
  const problem = passwordProblem(input.password);
  if (problem) return { success: false, error: problem };

  const admin = getSupabaseAdmin();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !created?.user) {
    const exists = /already|registered|exists/i.test(error?.message ?? "");
    return { success: false, error: exists ? "Вход с такой почтой уже есть" : `Не удалось создать вход: ${error?.message ?? "нет ответа"}` };
  }

  const { error: staffError } = await admin
    .from("staff")
    .insert({ id: created.user.id, full_name: fullName, role: input.role, is_active: true });
  if (staffError) {
    // Без записи сотрудника вход бесполезен и только путает — убираем его.
    await admin.auth.admin.deleteUser(created.user.id);
    return { success: false, error: "Не удалось сохранить вход, попробуйте ещё раз" };
  }

  done();
  return { success: true, data: { id: created.user.id } };
}

export type AccountUpdate = { id: string; fullName: string; role: string; isActive: boolean };

export async function updateAccount(input: AccountUpdate): Promise<Result> {
  const me = await requireStaffAction(isOwnerRole);
  const fullName = clean(input.fullName);
  if (!fullName) return { success: false, error: "Укажите имя" };
  if (!isStaffRole(input.role)) return { success: false, error: "Неизвестная роль" };

  const admin = getSupabaseAdmin();

  // Себя не выключить и не лишить прав: иначе можно случайно запереть
  // учёт от всех владельцев разом.
  if (input.id === me.id && (!input.isActive || !isOwnerRole(input.role))) {
    return { success: false, error: "Себе нельзя снять права владельца или выключить вход" };
  }

  const { data: before } = await admin.from("staff").select("role, is_active").eq("id", input.id).maybeSingle();
  if (!before) return { success: false, error: "Вход не найден" };

  const { error } = await admin
    .from("staff")
    .update({ full_name: fullName, role: input.role, is_active: input.isActive })
    .eq("id", input.id);
  if (error) return { success: false, error: "Не удалось сохранить вход" };

  // Хотя бы один владелец должен остаться. Проверяем после записи и,
  // если не так, возвращаем как было, — две вкладки не обойдут проверку.
  const { count } = await admin
    .from("staff")
    .select("id", { count: "exact", head: true })
    .in("role", ["owner", "admin"])
    .eq("is_active", true);
  if (!count) {
    await admin.from("staff").update({ role: before.role, is_active: before.is_active }).eq("id", input.id);
    return { success: false, error: "Должен остаться хотя бы один владелец" };
  }

  done();
  return { success: true, data: undefined };
}

export async function resetAccountPassword(id: string, password: string): Promise<Result> {
  await requireStaffAction(isOwnerRole);
  const problem = passwordProblem(password);
  if (problem) return { success: false, error: problem };
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(id, { password });
  if (error) return { success: false, error: `Не удалось сменить пароль: ${error.message}` };
  return { success: true, data: undefined };
}
