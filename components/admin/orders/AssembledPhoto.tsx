"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadAssembledPhoto, sendAssembledPhoto } from "@/lib/actions/orders";
import { prepareImageForUpload } from "@/lib/prepare-image";

type Props = {
  orderId: string;
  photoUrl: string | null;
  sentAt: string | null;
};

const sentFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Фото собранного букета для клиента.
 *
 * Загрузка и отправка — два отдельных действия. Так снимок можно
 * переснять и заменить, а клиенту уйдёт только то, что флорист
 * сознательно отправил. Новая загрузка снимает отметку об отправке —
 * значит, переснятое фото можно отправить снова.
 */
export function AssembledPhoto({ orderId, photoUrl, sentAt }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"upload" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setDone(null);
    setBusy("upload");

    const ready = await prepareImageForUpload(file);
    if (!ready.ok) {
      setError(ready.error);
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const formData = new FormData();
    formData.append("file", ready.file);
    const result = await uploadAssembledPhoto(orderId, formData);

    setBusy(null);
    if (inputRef.current) inputRef.current.value = "";

    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function handleSend() {
    setError(null);
    setDone(null);
    setBusy("send");

    startTransition(async () => {
      const result = await sendAssembledPhoto(orderId);
      setBusy(null);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setDone("Фото ушло клиенту в Telegram");
      router.refresh();
    });
  }

  return (
    <section className="mt-6 rounded-3xl border border-lavender-100 bg-white p-6">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink/50">
        Фото букета для клиента
      </h2>
      <p className="mt-2 max-w-prose font-body text-sm text-ink/60">
        Снимите собранный букет и отправьте — клиент увидит его до выезда курьера
        и успеет сказать, если что-то захочется поправить.
      </p>

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt="Собранный букет"
            className="h-40 w-40 shrink-0 rounded-2xl border border-lavender-100 object-cover"
          />
        ) : (
          <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-2xl border border-dashed border-lavender-300 bg-lavender-50 text-center font-body text-xs text-ink/40">
            Фото ещё нет
          </div>
        )}

        <div className="flex flex-col items-start gap-3">
          <input
            ref={inputRef}
            id={`photo-${orderId}`}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            onChange={handleFile}
          />
          <label
            htmlFor={`photo-${orderId}`}
            className="cursor-pointer rounded-full border border-lavender-200 px-5 py-2.5 font-display text-sm font-medium text-ink transition hover:border-gold-400 hover:text-gold-700"
          >
            {busy === "upload" ? "Загружаем…" : photoUrl ? "Заменить фото" : "Загрузить фото"}
          </label>

          {photoUrl && (
            <button
              type="button"
              onClick={handleSend}
              disabled={isPending || busy !== null || !!sentAt}
              className="rounded-full bg-gold-500 px-5 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-gold-600 disabled:opacity-50"
            >
              {busy === "send" ? "Отправляем…" : sentAt ? "Уже отправлено" : "Отправить клиенту"}
            </button>
          )}

          {sentAt && (
            <p className="font-body text-xs text-green-700">
              Отправлено {sentFormatter.format(new Date(sentAt))}
            </p>
          )}
          {done && <p className="font-body text-xs text-green-700">{done}</p>}
          {error && <p className="max-w-xs font-body text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </section>
  );
}
