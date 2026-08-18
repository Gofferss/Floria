"use client";

import { useState } from "react";
import { sendBroadcast, type BroadcastSummary } from "@/lib/actions/broadcast";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon } from "@/components/ui/Icons";

export function BroadcastForm() {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BroadcastSummary | null>(null);

  async function handleSend() {
    if (status === "sending" || !message.trim()) return;
    if (!window.confirm("Отправить это сообщение всем подписчикам бота? Действие не отменить.")) return;

    setStatus("sending");
    setError(null);
    setResult(null);

    const response = await sendBroadcast(message);
    setStatus("idle");

    if (!response.success) {
      setError(response.error);
      return;
    }

    setResult(response.data);
    setMessage("");
  }

  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
      {error && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mb-4 rounded-2xl border border-gold-400/40 bg-gold-500/5 px-4 py-3 font-body text-sm text-ink/70">
          Отправлено {result.sent} из {result.total}
          {result.failed > 0 && ` (не доставлено: ${result.failed} — вероятно, заблокировали бота)`}
        </div>
      )}

      <FormField
        label="Текст рассылки"
        htmlFor="broadcastMessage"
        hint="Уйдёт всем, кто хотя бы раз нажал /start у бота-напоминальщика"
      >
        <textarea
          id="broadcastMessage"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          placeholder={"Например: 🌷 Открыли предзаказы к 8 марта — успейте забронировать букет заранее!"}
          className={`${inputClass()} resize-y`}
        />
      </FormField>

      <button
        type="button"
        onClick={handleSend}
        disabled={status === "sending" || !message.trim()}
        className="mt-4 flex items-center justify-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {status === "sending" ? "Отправляем..." : "Отправить всем"}
        {status !== "sending" && <ArrowRightIcon className="h-4 w-4" />}
      </button>
    </div>
  );
}
