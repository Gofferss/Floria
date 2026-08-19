import { createClient } from "@supabase/supabase-js";

// ================================================================
// SMS-подтверждение номера ВНЕ браузерной сессии — используется ботом
// (app/api/telegram/webhook), где нет ни cookie, ни localStorage, чтобы
// держать сессию Supabase Auth между сообщениями. Каждый вызов создаёт
// свой одноразовый клиент (persistSession/autoRefreshToken выключены) —
// иначе общий модульный клиент (lib/supabase.ts, export const supabase)
// делил бы внутреннее auth-состояние между параллельными запросами
// разных пользователей бота, что на сервере с конкурентными запросами
// может перепутать, чья верификация прошла.
//
// Доставку самого SMS настраивает тот же Send SMS Hook, что и у формы
// входа на сайте (app/api/auth/sms-hook/route.ts) — с точки зрения этого
// модуля разницы никакой.
// ================================================================

function freshAuthClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function sendPhoneOtp(phone: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await freshAuthClient().auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: true },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function verifyPhoneOtp(phone: string, token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await freshAuthClient().auth.verifyOtp({ phone, token, type: "sms" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
