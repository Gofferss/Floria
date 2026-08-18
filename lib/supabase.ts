import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Не бросаем ошибку на этапе импорта (ломало бы сборку без .env) —
  // просто предупреждаем. Реальный сбой произойдёт при первом запросе.
  console.warn(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY не заданы — supabase-клиент не будет работать, пока не настроен .env"
  );
}

/**
 * Публичный клиент (anon-ключ). Безопасен для использования в клиентских
 * компонентах — доступ ограничен RLS-политиками (см. floria_schema.sql, Шаг 1).
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? "",
  supabaseAnonKey ?? ""
);

let adminClient: SupabaseClient | null = null;

/**
 * Административный клиент (service-role ключ). Обходит RLS.
 * Вызывать ТОЛЬКО из серверного кода (Route Handlers, Server Actions).
 * Никогда не импортировать в компонент с директивой "use client".
 *
 * Ленивая инициализация: клиент создаётся при первом вызове, а не при
 * импорте модуля, — чтобы отсутствие SUPABASE_SERVICE_ROLE_KEY не ломало
 * сборку/дев-сервер там, где эта функция не вызывается.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "getSupabaseAdmin() нельзя вызывать на клиенте — service-role ключ не должен попадать в браузер"
    );
  }

  if (adminClient) return adminClient;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Не заданы NEXT_PUBLIC_SUPABASE_URL и/или SUPABASE_SERVICE_ROLE_KEY в переменных окружения"
    );
  }

  adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return adminClient;
}
