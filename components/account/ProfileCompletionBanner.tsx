"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { PhoneIcon, ArrowRightIcon } from "@/components/ui/Icons";
import { isValidPhone } from "@/lib/checkout";

type ProfileCompletionBannerProps = {
  initialPhone: string | null;
};

/**
 * Раньше здесь была ссылка на Telegram-бота с поллингом (см. историю
 * коммитов) — бот собирал телефон через отдельный чат, а страница
 * незаметно спрашивала Supabase, не появился ли номер. С пивотом на VK
 * весь этот механизм не нужен: VK OAuth телефон не отдаёт вообще ни в
 * каком виде, поэтому единственный оставшийся способ его узнать — явно
 * спросить прямо здесь. Раз это теперь синхронный запрос-ответ, а не
 * ожидание внешнего события — поллинг тоже ушёл вместе с ботом.
 *
 * Два шага (номер → код из СМС), а не один — до аудита 2026-08-20 форма
 * привязывала введённый номер сразу, без проверки, что он действительно
 * принадлежит вошедшему. Если по этому номеру уже есть карточка клиента
 * (например, от чужого гостевого заказа), сервер переносит НА НЕЁ
 * историю заказов и бонусный баланс — без кода из СМС это было равносильно
 * перехвату чужого аккаунта по одному только известному номеру.
 */
export function ProfileCompletionBanner({ initialPhone }: ProfileCompletionBannerProps) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [inputValue, setInputValue] = useState("");
  const [code, setCode] = useState("");
  const [justCompleted, setJustCompleted] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSendCode() {
    if (!isValidPhone(inputValue)) {
      setStatus("error");
      setErrorMessage("Проверьте номер телефона");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/account/phone/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: inputValue }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Не удалось отправить код");
      }

      setStep("code");
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Не удалось отправить код");
    }
  }

  async function handleVerifyCode() {
    if (code.trim().length < 4) {
      setStatus("error");
      setErrorMessage("Введите код из СМС");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/account/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: inputValue, code: code.trim() }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Не удалось сохранить номер");
      }

      setPhone(inputValue);
      setJustCompleted(true);
      setStatus("idle");
      // Даём анимации сворачивания доиграть, затем синхронизируем
      // остальную часть страницы с сервером (карточка профиля сбоку).
      window.setTimeout(() => router.refresh(), 550);
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Не удалось сохранить номер");
    }
  }

  function handleChangePhone() {
    setStep("phone");
    setCode("");
    setErrorMessage(null);
  }

  // Телефон был известен ещё до монтирования (или уже сохранён) — баннера
  // никогда не было и не будет, схлопывать нечего.
  if (phone && !justCompleted) return null;

  return (
    <div
      className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-500 ease-out ${
        justCompleted ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
      }`}
    >
      <div className="min-h-0">
        <div className="rounded-3xl border border-gold-400/40 bg-gold-500/5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-500/15 text-gold-600">
              <PhoneIcon className="h-4 w-4" />
            </span>
            <div>
              <p className="font-display text-sm font-semibold text-ink">
                Осталось узнать ваш номер телефона
              </p>
              <p className="mt-1 font-body text-sm leading-relaxed text-ink/60">
                Он нужен, чтобы отслеживать заказы и начислять бонусы.
              </p>
            </div>
          </div>

          {step === "phone" ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex-1">
                <FormField
                  label="Телефон"
                  htmlFor="accountPhone"
                  error={status === "error" ? errorMessage ?? undefined : undefined}
                >
                  <input
                    id="accountPhone"
                    type="tel"
                    autoComplete="tel"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                    placeholder="+7 (___) ___-__-__"
                    className={inputClass(status === "error")}
                  />
                </FormField>
              </div>

              <button
                type="button"
                onClick={handleSendCode}
                disabled={status === "submitting"}
                className="mt-1 flex items-center justify-center gap-2 rounded-full bg-gold-500 px-6 py-3 font-display text-sm font-semibold text-white transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70 sm:mt-[26px]"
              >
                {status === "submitting" ? "Отправляем..." : "Получить код"}
                {status !== "submitting" && <ArrowRightIcon className="h-3.5 w-3.5" />}
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <p className="font-body text-xs text-ink/50">
                Код отправлен на {inputValue}.{" "}
                <button type="button" onClick={handleChangePhone} className="text-gold-600 underline underline-offset-2 hover:text-gold-700">
                  Изменить номер
                </button>
              </p>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex-1">
                  <FormField
                    label="Код из СМС"
                    htmlFor="accountPhoneCode"
                    error={status === "error" ? errorMessage ?? undefined : undefined}
                  >
                    <input
                      id="accountPhoneCode"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
                      placeholder="••••••"
                      autoFocus
                      className={`${inputClass(status === "error")} tracking-[0.3em]`}
                    />
                  </FormField>
                </div>

                <button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={status === "submitting"}
                  className="mt-1 flex items-center justify-center gap-2 rounded-full bg-gold-500 px-6 py-3 font-display text-sm font-semibold text-white transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70 sm:mt-[26px]"
                >
                  {status === "submitting" ? "Проверяем..." : "Подтвердить"}
                  {status !== "submitting" && <ArrowRightIcon className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
