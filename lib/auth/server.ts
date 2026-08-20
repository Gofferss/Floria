import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";

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

/** Для серверных компонентов в /admin/**: не сотрудник — редирект на /login. */
export async function requireStaffUser(): Promise<StaffUser> {
  const staff = await getStaffUser();
  if (!staff) {
    redirect("/login?redirect=/admin");
  }
  return staff;
}