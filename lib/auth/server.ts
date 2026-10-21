import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canUseSiteAdmin, homePathFor } from "@/lib/auth/roles";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch (error) {
            // Игнорируем ошибку при вызове из серверных компонентов
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.delete({ name, ...options });
          } catch (error) {
            // Игнорируем ошибку при вызове из серверных компонентов
          }
        },
      },
    }
  );
}

export type StaffUser = {
  id: string;
  role: string;
  fullName: string;
};

/**
 * Сотрудник текущей сессии или null. Сессия проверяется через
 * createSupabaseServerClient (anon-ключ + cookie), но сама запись из
 * таблицы staff читается через getSupabaseAdmin (service-role) — таблица
 * закрыта RLS без единой политики (см. migrations/001_setup_full_db.sql,
 * раздел 7: "запись и чтение [privileged-таблиц] идёт через service-role
 * ключ"), поэтому обычный authenticated-клиент её не прочитает.
 */
export async function getStaffUser(): Promise<StaffUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: staff, error } = await getSupabaseAdmin()
    .from("staff")
    .select("id, role, full_name, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !staff || !staff.is_active) return null;

  return { id: staff.id, role: staff.role as string, fullName: staff.full_name as string };
}

/**
 * Для серверных компонентов в /admin/** и /uchet/**: не сотрудник — редирект
 * на /login. После входа человек возвращается туда, откуда пришёл: флорист,
 * открывший учёт, должен попасть в учёт, а не в админку сайта.
 *
 * `allow` — кому из сотрудников сюда можно (lib/auth/roles.ts). По
 * умолчанию — админка сайта. Сотрудника, которому нельзя, не ругаем, а
 * ведём туда, где его работа: флориста — в учёт.
 */
export async function requireStaffUser(
  returnTo: string = "/admin",
  allow: (role: string) => boolean = canUseSiteAdmin
): Promise<StaffUser> {
  const staff = await getStaffUser();
  if (!staff) {
    redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
  }
  if (!allow(staff.role)) {
    redirect(homePathFor(staff.role));
  }
  return staff;
}

/**
 * То же для серверных действий: там некуда перенаправлять, поэтому
 * отказ — исключение. Каждое действие обязано звать это само: страница,
 * на которой нет кнопки, не мешает вызвать действие напрямую.
 */
export async function requireStaffAction(
  allow: (role: string) => boolean = canUseSiteAdmin
): Promise<StaffUser> {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  if (!allow(staff.role)) throw new Error("Этот раздел вашей учётной записи недоступен");
  return staff;
}