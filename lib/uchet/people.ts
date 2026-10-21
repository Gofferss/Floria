import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Люди и входы — чтение для раздела «Сотрудники».
//
// Две разные вещи, и их нельзя путать:
//   * вход (staff + auth.users) — учётная запись с почтой и паролем: у
//     владельцев личная, у айпада магазина общая, у курьера своя;
//   * человек (hr_employees) — тот, кто работает за общим айпадом и
//     подписывает свои действия PIN.
// ================================================================

import type { Position } from "@/lib/uchet/positions";

export { POSITIONS, POSITION_LABEL, type Position } from "@/lib/uchet/positions";

export type EmployeeRow = {
  id: string;
  fullName: string;
  shortName: string;
  position: Position;
  canApprove: boolean;
  hasPin: boolean;
  staffId: string | null;
  isActive: boolean;
};

export async function listEmployees(): Promise<EmployeeRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("hr_employees")
    .select("id, full_name, short_name, position, can_approve, pin_hash, staff_id, is_active, sort")
    .order("is_active", { ascending: false })
    .order("sort")
    .order("short_name");
  if (error) throw new Error(`Сотрудники: ${error.message}`);
  return (data ?? []).map((e) => ({
    id: e.id,
    fullName: e.full_name,
    shortName: e.short_name,
    position: e.position as Position,
    canApprove: e.can_approve,
    // Сам хэш наружу не отдаём — только факт, что PIN задан.
    hasPin: !!e.pin_hash,
    staffId: e.staff_id,
    isActive: e.is_active,
  }));
}

/** Для окна «Кто работает»: только те, кто может войти. */
export type PickableEmployee = { id: string; shortName: string; fullName: string };

export async function listPickableEmployees(): Promise<PickableEmployee[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("hr_employees")
    .select("id, short_name, full_name")
    .eq("is_active", true)
    .not("pin_hash", "is", null)
    .order("sort")
    .order("short_name");
  if (error) throw new Error(`Сотрудники: ${error.message}`);
  return (data ?? []).map((e) => ({ id: e.id, shortName: e.short_name, fullName: e.full_name }));
}

/** Тех, кто может подтвердить скидку сверх лимита, — для окна подтверждения. */
export async function listApprovers(): Promise<PickableEmployee[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("hr_employees")
    .select("id, short_name, full_name")
    .eq("is_active", true)
    .eq("can_approve", true)
    .not("pin_hash", "is", null)
    .order("short_name");
  if (error) throw new Error(`Сотрудники: ${error.message}`);
  return (data ?? []).map((e) => ({ id: e.id, shortName: e.short_name, fullName: e.full_name }));
}

export type AccountRow = {
  id: string;
  fullName: string;
  role: string;
  isActive: boolean;
  email: string | null;
  lastSignInAt: string | null;
};

export async function listAccounts(): Promise<AccountRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("staff").select("id, full_name, role, is_active, created_at").order("created_at");
  if (error) throw new Error(`Входы: ${error.message}`);

  // Почта и последний вход живут в auth.users. Берём каждого по id, а не
  // списком: среди пользователей тысячи покупателей (вход по телефону), и
  // сотрудник мог бы не попасть на первую страницу.
  const emails = new Map<string, { email: string | null; last: string | null }>();
  await Promise.all(
    (data ?? []).map(async (s) => {
      const { data: u } = await admin.auth.admin.getUserById(s.id);
      if (u?.user) emails.set(s.id, { email: u.user.email ?? null, last: u.user.last_sign_in_at ?? null });
    })
  );

  return (data ?? []).map((s) => ({
    id: s.id,
    fullName: s.full_name,
    role: s.role,
    isActive: s.is_active,
    email: emails.get(s.id)?.email ?? null,
    lastSignInAt: emails.get(s.id)?.last ?? null,
  }));
}
