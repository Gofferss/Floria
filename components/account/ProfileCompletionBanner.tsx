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
 */
export function ProfileCompletionBanner({ initialPhone }: ProfileCompletionBannerProps) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone);
  const [inputValue, setInputValue] = useState("");
  const [justCompleted, setJustCompleted] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit() {
    if (!isValidPhone(inputValue)) {
      setStatus("error");
      setErrorMessage("Проверьте номер телефона");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/account/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: inputValue }),
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
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="+7 (___) ___-__-__"
                  className={inputClass(status === "error")}
                />
              </FormField>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={status === "submitting"}
              className="mt-1 flex items-center justify-center gap-2 rounded-full bg-gold-500 px-6 py-3 font-display text-sm font-semibold text-white transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70 sm:mt-[26px]"
            >
              {status === "submitting" ? "Сохраняем..." : "Сохранить"}
              {status !== "submitting" && <ArrowRightIcon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
