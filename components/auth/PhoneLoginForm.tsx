"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/auth/client";
import { formatRussianPhoneInput, toE164RussianPhone } from "@/lib/phone-mask";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon } from "@/components/ui/Icons";

const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Оба шага используют РОДНЫЕ методы Supabase (signInWithOtp / verifyOtp)
 * напрямую — сессия появляется без какого-либо моста с нашей стороны,
 * в отличие от прежних попыток с Telegram/VK. Доставку самого SMS
 * настраивает Send SMS Hook (app/api/auth/sms-hook/route.ts) —
 * с точки зрения этой формы разницы никакой, как будто SMS отправляет
 * сам Supabase.
 */
export function PhoneLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/account";

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [code, setCode] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const e164Phone = toE164RussianPhone(phoneInput);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    const interval = window.setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleSendCode() {
    if (!e164Phone) {
      setErrorMessage("Проверьте номер телефона");
      return;
    }

    if (!consentGiven) {
      setErrorMessage("Подтвердите согласие на обработку персональных данных");
      return;
    }

    setStatus("loading");
    setErrorMessage(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      phone: e164Phone,
      options: { shouldCreateUser: true },
    });

    setStatus("idle");

    if (error) {
      console.error("Ошибка отправки SMS-кода:", error);
      setErrorMessage(error.message === "Invalid phone number" ? "Проверьте номер телефона" : error.message);
      return;
    }

    setStep("code");
    startCooldown();
  }

  async function handleVerifyCode() {
    if (!e164Phone) return;
    if (code.trim().length < 4) {
      setErrorMessage("Введите код из СМС");
      return;
    }

    setStatus("loading");
    setErrorMessage(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.verifyOtp({
      phone: e164Phone,
      token: code.trim(),
      type: "sms",
    });

    if (error) {
      console.error("Ошибка проверки кода:", error);
      setErrorMessage(
        error.message === "Token has expired or is invalid" ? "Неверный или устаревший код" : error.message
      );
      setStatus("idle");
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  function handleChangePhone() {
    setStep("phone");
    setCode("");
    setErrorMessage(null);
  }

  if (step === "code") {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <p className="font-body text-sm text-ink/60">
            Код отправлен на <span className="font-semibold text-ink">{formatRussianPhoneInput(phoneInput)}</span>
          </p>
          <button
            type="button"
            onClick={handleChangePhone}
            className="mt-1 font-body text-xs text-gold-600 underline underline-offset-2 hover:text-gold-700"
          >
            Изменить номер
          </button>
        </div>

        <FormField label="Код из СМС" htmlFor="smsCode" error={errorMessage ?? undefined}>
          <input
            id="smsCode"
            type="tel"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
            placeholder="••••••"
            autoFocus
            className={`${inputClass(!!errorMessage)} text-center font-display text-lg tracking-[0.3em]`}
          />
        </FormField>

        <button
          type="button"
          onClick={handleVerifyCode}
          disabled={status === "loading"}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gold-500 px-6 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "loading" ? "Проверяем..." : "Подтвердить"}
          {status !== "loading" && <ArrowRightIcon className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={handleSendCode}
          disabled={cooldown > 0 || status === "loading"}
          className="font-body text-sm text-ink/50 underline underline-offset-2 transition hover:text-ink disabled:cursor-not-allowed disabled:text-ink/30 disabled:no-underline"
        >
          {cooldown > 0 ? `Отправить код ещё раз через ${cooldown} с` : "Отправить код ещё раз"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormField label="Номер телефона" htmlFor="loginPhone" error={errorMessage ?? undefined}>
        <input
          id="loginPhone"
          type="tel"
          autoComplete="tel"
          value={phoneInput}
          onChange={(e) => setPhoneInput(formatRussianPhoneInput(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
          placeholder="+7 (___) ___-__-__"
          autoFocus
          className={inputClass(!!errorMessage)}
        />
      </FormField>

      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={consentGiven}
          onChange={(e) => setConsentGiven(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-lavender-300 accent-gold-500"
        />
        <span className="font-body text-xs leading-relaxed text-ink/60">
          Я согласен с{" "}
          <Link href="/privacy" target="_blank" className="text-gold-600 underline underline-offset-2 hover:text-gold-700">
            Политикой конфиденциальности
          </Link>
        </span>
      </label>

      <button
        type="button"
        onClick={handleSendCode}
        disabled={status === "loading" || !consentGiven}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-gold-500 px-6 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {status === "loading" ? "Отправляем код..." : "Получить код"}
        {status !== "loading" && <ArrowRightIcon className="h-4 w-4" />}
      </button>

      <p className="text-balance text-center font-body text-xs leading-relaxed text-ink/40">
        Мы пришлём одноразовый код в СМС — паролей нет.
      </p>
    </div>
  );
}
