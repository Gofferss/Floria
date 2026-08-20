"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Server Actions для самообслуживания в /account. customers закрыта RLS
// без единой политики (см. миграцию 001, раздел 7) — значит, любое
// изменение своих же данных идёт отсюда: сессия проверяется через
// createSupabaseServerClient (cookie), а сама запись — через
// service-role, с явным .eq("auth_user_id", user.id), чтобы обновить
// можно было только СВОЮ карточку.
//
// Раньше EditableName.tsx писал в customers прямо с клиента через
// authenticated-ключ — без UPDATE-политики это молча обновляло 0 строк
// (запрос "успешен", но ничего не сохранялось) — найдено при аудите
// 2026-08-20.
// ================================================================

type ActionResult = { success: true } | { success: false; error: string };

export async function updateCustomerName(name: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Не авторизованы" };

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Имя не может быть пустым" };

  const { error } = await getSupabaseAdmin()
    .from("customers")
    .update({ full_name: trimmed })
    .eq("auth_user_id", user.id);

  if (error) {
    console.error("[updateCustomerName]", error.message);
    return { success: false, error: "Не удалось сохранить — обратитесь к администратору" };
  }

  revalidatePath("/account");
  return { success: true };
}
