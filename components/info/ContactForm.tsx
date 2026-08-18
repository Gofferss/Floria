"use client";

import { useState } from "react";
import Link from "next/link";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/Icons";
import { formatRussianPhoneInput } from "@/lib/phone-mask";
import { isValidPhone } from "@/lib/checkout";
import { trackEvent } from "@/lib/analytics/track";

type Errors = Partial<Record<"name" | "phone", string>>;

export function ContactForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"form" | "sending" | "sent">("form");
  const [submitError, setSubmitError] = useState<string | null>(null);

  function validate(): boolean {
    const next: Errors = {};
    if (!name.trim()) next.name = "Укажите имя";
    if (!isValidPhone(phone)) next.phone = "Проверьте номер телефона";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (status === "sending" || !consentGiven) return;
    if (!validate()) return;

    setStatus("sending");
    setSubmitError(null);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, message }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error ?? "Не удалось отправить заявку. Попробуйте ещё раз.");
      }

      trackEvent("button_click", "Отправить заявку (обратный звонок)");
      setStatus("sent");
    } catch (error) {
      console.error("Ошибка отправки заявки на обратный звонок:", error);
      setSubmitError(
        error instanceof Error ? error.message : "Не удалось отправить заявку. Попробуйте ещё раз."
      );
      setStatus("form");
    }
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col items-center rounded-3xl border border-lavender-100 bg-white p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gold-500 text-white">
          <CheckIcon className="h-6 w-6" />
        </span>
        <h3 className="mt-5 font-display text-lg font-semibold text-ink">
          Заявка отправлена
        </h3>
        <p className="mt-2 font-body text-sm leading-relaxed text-ink/60">
          Мы перезвоним на номер {phone} в рабочее время — обычно в течение
          15–20 минут.
        </p>
        <button
          type="button"
          onClick={() => {
            setName("");
            setPhone("");
            setMessage("");
            setConsentGiven(false);
            setStatus("form");
          }}
          className="mt-5 font-body text-sm text-gold-600 underline underline-offset-4 transition hover:text-gold-700"
        >
          Отправить ещё одну
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
      <h2 className="font-display text-lg font-semibold text-ink">Задать вопрос</h2>
      <p className="mt-1.5 font-body text-sm leading-relaxed text-ink/60">
        Оставьте номер — перезвоним и поможем подобрать букет или рассчитать
        оформление.
      </p>

      {submitError && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700">
          {submitError}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-4">
        <FormField label="Имя" htmlFor="contactName" required error={errors.name}>
          <input
            id="contactName"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Как к вам обращаться"
            className={inputClass(!!errors.name)}
          />
        </FormField>

        <FormField label="Телефон" htmlFor="contactPhone" required error={errors.phone}>
          <input
            id="contactPhone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(formatRussianPhoneInput(e.target.value))}
            placeholder="+7 (___) ___-__-__"
            className={inputClass(!!errors.phone)}
          />
        </FormField>

        <FormField label="Сообщение" htmlFor="contactMessage" hint="Необязательно">
          <textarea
            id="contactMessage"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Например: нужен букет на юбилей, бюджет до 5000 ₽"
            className={`${inputClass()} resize-none`}
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
            Согласен с{" "}
            <Link href="/consent" target="_blank" className="text-gold-600 underline underline-offset-2 hover:text-gold-700">
              обработкой персональных данных
            </Link>
          </span>
        </label>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={status === "sending" || !consentGiven}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-gold-500 px-6 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "sending" ? "Отправляем..." : "Отправить заявку"}
          {status !== "sending" && <ArrowRightIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
