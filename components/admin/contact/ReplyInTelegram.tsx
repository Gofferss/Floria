"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { replyInTelegram } from "@/lib/actions/contact-requests";

/**
 * Ответ клиенту в Telegram, прямо из карточки обращения.
 *
 * Поле свёрнуто до нажатия: в списке бывает два десятка обращений, и
 * развёрнутые текстовые поля у каждого превращают страницу в простыню.
 *
 * Подтверждения перед отправкой нет, но есть предупреждение в подписи:
 * сообщение уходит живому человеку и обратно его не забрать.
 */
export function ReplyInTelegram({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSend() {
    setError(null);
    startTransition(async () => {
      const result = await replyInTelegram(id, text);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setText("");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-lavender-200 px-4 py-2 font-display text-xs font-semibold text-ink transition hover:border-gold-400 hover:text-gold-700"
      >
        Ответить в Telegram
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-lavender-200 bg-lavender-50/50 p-4">
      <label htmlFor={`reply-${id}`} className="font-display text-xs font-semibold text-ink/70">
        Ответ для {name} — уйдёт в Telegram от имени студии
      </label>
      <textarea
        id={`reply-${id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        autoFocus
        placeholder="Здравствуйте! …"
        className="mt-2 w-full rounded-xl border border-lavender-200 bg-white px-3 py-2 font-body text-sm text-ink outline-none focus:border-gold-400"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSend}
          disabled={isPending || !text.trim()}
          className="rounded-full bg-gold-500 px-5 py-2 font-display text-xs font-semibold text-white transition hover:bg-gold-600 disabled:opacity-50"
        >
          {isPending ? "Отправляем…" : "Отправить"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={isPending}
          className="font-display text-xs font-medium text-ink/60 underline underline-offset-4 transition hover:text-ink disabled:opacity-50"
        >
          Отмена
        </button>
        <span className="font-body text-xs text-ink/40">Отправленное не отозвать</span>
      </div>
      {error && <p className="mt-2 font-body text-xs text-red-600">{error}</p>}
    </div>
  );
}
