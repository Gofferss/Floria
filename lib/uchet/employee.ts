import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getStaffUser, type StaffUser } from "@/lib/auth/server";
import { isOwnerRole } from "@/lib/auth/roles";
import { verifyPin } from "@/lib/uchet/pin";

// ================================================================
// Кто сейчас работает за планшетом.
//
// Учётная запись магазина одна на всех, поэтому «кто» хранится отдельно:
// человек выбирает себя, вводит PIN, и сервер ставит подписанную куку
// «сотрудник N на этой учётной записи до такого-то часа». Подпись — HMAC
// ключом, который знает только сервер, поэтому подделать или перенести
// куку на другую учётную запись нельзя.
//
// У владельца с личным входом кука не нужна: его учётная запись привязана
// к записи сотрудника (hr_employees.staff_id) и сама говорит, кто это.
// ================================================================

const COOKIE = "uchet_emp";
/** Смена длинная, но не вечная: утром человек подтверждает себя заново. */
const TTL_MS = 14 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

export type Employee = {
  id: string;
  fullName: string;
  shortName: string;
  position: string;
  canApprove: boolean;
};

export type Actor = {
  staff: StaffUser;
  employee: Employee | null;
};

function signingKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Нет серверного ключа для подписи");
  return createHmac("sha256", secret).update("floria-uchet-employee-v1").digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function readCookie(value: string | undefined, staffId: string): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [employeeId, cookieStaff, exp, sig] = parts;
  const expected = Buffer.from(sign(`${employeeId}.${cookieStaff}.${exp}`));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (cookieStaff !== staffId) return null;
  if (!(Number(exp) > Date.now())) return null;
  return employeeId;
}

type EmployeeRow = {
  id: string;
  full_name: string;
  short_name: string;
  position: string;
  can_approve: boolean;
};

const toEmployee = (r: EmployeeRow): Employee => ({
  id: r.id,
  fullName: r.full_name,
  shortName: r.short_name,
  position: r.position,
  canApprove: r.can_approve,
});

const EMPLOYEE_SELECT = "id, full_name, short_name, position, can_approve";

/** Сотрудник за этой учётной записью сейчас, или null. */
export async function getCurrentEmployee(staff: StaffUser): Promise<Employee | null> {
  const admin = getSupabaseAdmin();

  const { data: linked } = await admin
    .from("hr_employees")
    .select(EMPLOYEE_SELECT)
    .eq("staff_id", staff.id)
    .eq("is_active", true)
    .maybeSingle();
  if (linked) return toEmployee(linked as EmployeeRow);

  const store = await cookies();
  const employeeId = readCookie(store.get(COOKIE)?.value, staff.id);
  if (!employeeId) return null;

  const { data } = await admin
    .from("hr_employees")
    .select(EMPLOYEE_SELECT)
    .eq("id", employeeId)
    .eq("is_active", true)
    .maybeSingle();
  return data ? toEmployee(data as EmployeeRow) : null;
}

/** Есть ли вообще люди с PIN — без них выбирать «кто работает» не из кого. */
export async function hasPinEmployees(): Promise<boolean> {
  const { count } = await getSupabaseAdmin()
    .from("hr_employees")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .not("pin_hash", "is", null);
  return (count ?? 0) > 0;
}

/**
 * Нужно ли этой учётной записи выбрать человека. Владельцу — нет: его
 * учётная запись личная. Общей учётной записи магазина — да, как только
 * владелец завёл хотя бы одного человека с PIN.
 */
export async function needsEmployee(staff: StaffUser, current: Employee | null): Promise<boolean> {
  if (current || isOwnerRole(staff.role)) return false;
  return hasPinEmployees();
}

export type PinResult = { success: true; employee: Employee } | { success: false; error: string };

type PinRow = EmployeeRow & {
  pin_hash: string | null;
  pin_failed: number | null;
  pin_locked_until: string | null;
  is_active: boolean;
};

/**
 * Проверка PIN с блокировкой: после 5 ошибок подряд — пауза.
 * Одна на вход и на подтверждение скидки, иначе PIN того, кто подтверждает,
 * можно было бы перебрать через окно скидки.
 */
async function checkPin(employeeId: string, pin: string): Promise<{ ok: true; row: PinRow } | { ok: false; error: string }> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("hr_employees")
    .select(`${EMPLOYEE_SELECT}, pin_hash, pin_failed, pin_locked_until, is_active`)
    .eq("id", employeeId)
    .maybeSingle();
  const row = data as PinRow | null;
  if (!row || !row.is_active) return { ok: false, error: "Такого сотрудника нет" };
  if (!row.pin_hash) return { ok: false, error: "PIN не задан — попросите владельца задать его в «Сотрудниках»" };

  if (row.pin_locked_until && new Date(row.pin_locked_until).getTime() > Date.now()) {
    const minutes = Math.ceil((new Date(row.pin_locked_until).getTime() - Date.now()) / 60_000);
    return { ok: false, error: `PIN введён неверно ${MAX_FAILS} раз. Попробуйте через ${minutes} мин.` };
  }

  if (!verifyPin(pin, row.pin_hash)) {
    const fails = (row.pin_failed ?? 0) + 1;
    const locked = fails >= MAX_FAILS;
    await admin
      .from("hr_employees")
      .update({ pin_failed: locked ? 0 : fails, pin_locked_until: locked ? new Date(Date.now() + LOCK_MS).toISOString() : null })
      .eq("id", employeeId);
    return {
      ok: false,
      error: locked ? `PIN введён неверно ${MAX_FAILS} раз. Вход заблокирован на 5 минут` : `Неверный PIN. Осталось попыток: ${MAX_FAILS - fails}`,
    };
  }

  if (row.pin_failed || row.pin_locked_until) {
    await admin.from("hr_employees").update({ pin_failed: 0, pin_locked_until: null }).eq("id", employeeId);
  }
  return { ok: true, row };
}

/** Проверить PIN и запомнить человека за этой учётной записью. */
export async function signInEmployee(employeeId: string, pin: string): Promise<PinResult> {
  const staff = await getStaffUser();
  if (!staff) return { success: false, error: "Учётная запись не вошла" };

  const checked = await checkPin(employeeId, pin);
  if (!checked.ok) return { success: false, error: checked.error };

  const exp = Date.now() + TTL_MS;
  const payload = `${employeeId}.${staff.id}.${exp}`;
  const store = await cookies();
  store.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/uchet",
    maxAge: TTL_MS / 1000,
  });

  return { success: true, employee: toEmployee(checked.row) };
}

export async function signOutEmployee(): Promise<void> {
  const store = await cookies();
  store.delete({ name: COOKIE, path: "/uchet" });
}

/**
 * Подтверждение чужим PIN — например, скидки сверх лимита. Человека не
 * переключает: продаёт тот же, кто продавал, подтверждает тот, кому можно.
 */
export async function verifyApprover(employeeId: string, pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const checked = await checkPin(employeeId, pin);
  if (!checked.ok) return checked;
  if (!checked.row.can_approve) return { ok: false, error: "Этот сотрудник не может подтверждать скидки" };
  return { ok: true };
}

// ---------------------------------------------------------------
// Допуск на скидку
// ---------------------------------------------------------------

/** Подтверждение живёт, пока чек не оплачен: дольше держать его незачем. */
const APPROVAL_TTL_MS = 15 * 60 * 1000;

/**
 * Подписанный допуск «такой-то разрешил скидку N% на этой учётной записи до
 * такого-то времени». Его, а не PIN, планшет держит до оплаты: PIN
 * проверяется один раз и в памяти браузера не остаётся.
 */
export function issueApproval(employeeId: string, percent: number, staffId: string): string {
  const payload = `${employeeId}.${percent}.${staffId}.${Date.now() + APPROVAL_TTL_MS}`;
  return `${payload}.${sign(`approval:${payload}`)}`;
}

/** Кто разрешил скидку не меньше percent, или null, если допуск не годится. */
export function checkApproval(token: string | null | undefined, percent: number, staffId: string): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [employeeId, approvedPercent, tokenStaff, exp, sig] = parts;
  const expected = Buffer.from(sign(`approval:${employeeId}.${approvedPercent}.${tokenStaff}.${exp}`));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (tokenStaff !== staffId || !(Number(exp) > Date.now())) return null;
  if (!(Number(approvedPercent) >= percent)) return null;
  return employeeId;
}

/** Для действий: кто делает, или понятная причина, почему нельзя. */
export async function actorFor(staff: StaffUser): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee(staff);
  if (await needsEmployee(staff, employee)) {
    return { ok: false, error: "Сначала выберите, кто работает: кнопка с именем вверху справа" };
  }
  return { ok: true, actor: { staff, employee } };
}
