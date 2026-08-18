"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/auth/client";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon } from "@/components/ui/Icons";

/**
 * Только вход, без регистрации: клиенты теперь входят через Telegram
 * (TelegramLoginView), а сотрудников через публичную форму заводить нельзя
 * в принципе — это единственная гарантия, что /admin не достанется кому
 * попало (см. migrations/000_full_setup_with_telegram.sql).
 */
export function StaffLoginView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [formError, setFormError] = useState<string | null>(null);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!email.trim()) next.email = "Укажите email";
    if (password.length < 6) next.password = "Минимум 6 символов";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (status === "submitting") return;
    if (!validate()) return;

    setStatus("submitting");
    setFormError(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setFormError(
        error.message === "Invalid login credentials" ? "Неверный email или пароль" : error.message
      );
      setStatus("idle");
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-6">
      <h2 className="font-display text-base font-semibold text-ink">Вход для сотрудников</h2>

      {formError && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4">
        <FormField label="Email" htmlFor="staffEmail" required error={errors.email}>
          <input
            id="staffEmail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass(!!errors.email)}
          />
        </FormField>

        <FormField label="Пароль" htmlFor="staffPassword" required error={errors.password}>
          <input
            id="staffPassword"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass(!!errors.password)}
          />
        </FormField>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={status === "submitting"}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-gold-500 px-6 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "submitting" ? "Секунду..." : "Войти"}
          {status !== "submitting" && <ArrowRightIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
