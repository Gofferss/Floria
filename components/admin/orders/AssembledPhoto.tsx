"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadAssembledPhoto,
  removeAssembledPhoto,
  sendAssembledPhoto,
} from "@/lib/actions/orders";
import { prepareImageForUpload } from "@/lib/prepare-image";

type Props = {
  orderId: string;
  photoUrls: string[];
  sentAt: string | null;
};

const sentFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/** «3 фотографии» — чтобы в подписи не было «3 фотографий». */
function photoCount(n: number): string {
  const last = n % 10;
  const hundred = n % 100;
  if (last === 1 && hundred !== 11) return `${n} фотография`;
  if (last >= 2 && last <= 4 && (hundred < 12 || hundred > 14)) return `${n} фотографии`;
  return `${n} фотографий`;
}

/**
 * Фотографии собранного заказа для клиента.
 *
 * Снимков может быть несколько: в заказе бывает два, три, пять букетов,
 * и клиент должен увидеть каждый. Раньше поле было одно, и за остальные
 * букеты клиент платил вслепую.
 *
 * Загрузка и отправка — два отдельных действия. Так набор можно собрать
 * и поправить, а клиенту уйдёт только то, что флорист сознательно
 * отправил. Любое изменение набора снимает отметку об отправке: набор
 * стал другим, и клиент его ещё не видел.
 *
 * Файлы отправляются по одному, а не пачкой в одном запросе: у серверных
 * действий Next есть потолок на размер тела (8 МБ), и три фотографии с
 * телефона его перебьют. Поштучно это ещё и видно по счётчику.
 */
export function AssembledPhoto({ orderId, photoUrls, sentAt }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"upload" | "send" | "remove" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setError(null);
    setDone(null);
    setBusy("upload");

    const failed: string[] = [];

    for (let i = 0; i < files.length; i++) {
      setProgress(files.length > 1 ? `Загружаем ${i + 1} из ${files.length}…` : "Загружаем…");

      const ready = await prepareImageForUpload(files[i]);
      if (!ready.ok) {
        failed.push(`${files[i].name}: ${ready.error}`);
        continue;
      }

      const formData = new FormData();
      formData.append("file", ready.file);
      const result = await uploadAssembledPhoto(orderId, formData);
      if (!result.success) failed.push(`${files[i].name}: ${result.error}`);
    }

    setBusy(null);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = "";

    // Часть файлов могла не дойти — молчать об этом нельзя: флорист решит,
    // что отправил клиенту все букеты, а уйдёт неполный набор.
    if (failed.length > 0) setError(failed.join("; "));
    router.refresh();
  }

  function handleRemove(url: string) {
    setError(null);
    setDone(null);
    setBusy("remove");

    startTransition(async () => {
      const result = await removeAssembledPhoto(orderId, url);
      setBusy(null);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
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
      setDone(
        photoUrls.length > 1
          ? `${photoCount(photoUrls.length)} ушли клиенту в Telegram`
          : "Фото ушло клиенту в Telegram"
      );
      router.refresh();
    });
  }

  const hasPhotos = photoUrls.length > 0;
  const working = isPending || busy !== null;

  return (
    <section className="mt-6 rounded-3xl border border-lavender-100 bg-white p-6">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink/50">
        Фото букетов для клиента
      </h2>
      <p className="mt-2 max-w-prose font-body text-sm text-ink/60">
        Снимите каждый букет из заказа и отправьте — клиент увидит их до выезда
        курьера и успеет сказать, если что-то захочется поправить. Можно выбрать
        сразу несколько файлов.
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        {photoUrls.map((url, i) => (
          <div key={url} className="relative">
            <img
              src={url}
              alt={`Букет ${i + 1}`}
              className="h-40 w-40 rounded-2xl border border-lavender-100 object-cover"
            />
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-display text-xs font-semibold text-white">
              {i + 1}
            </span>
            <button
              type="button"
              onClick={() => handleRemove(url)}
              disabled={working}
              aria-label={`Убрать фото ${i + 1}`}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 font-display text-sm text-white transition hover:bg-red-600 disabled:opacity-50"
            >
              ×
            </button>
          </div>
        ))}

        {!hasPhotos && (
          <div className="flex h-40 w-40 items-center justify-center rounded-2xl border border-dashed border-lavender-300 bg-lavender-50 text-center font-body text-xs text-ink/40">
            Фото ещё нет
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col items-start gap-3">
        <input
          ref={inputRef}
          id={`photo-${orderId}`}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="hidden"
          onChange={handleFiles}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor={`photo-${orderId}`}
            className="cursor-pointer rounded-full border border-lavender-200 px-5 py-2.5 font-display text-sm font-medium text-ink transition hover:border-gold-400 hover:text-gold-700"
          >
            {busy === "upload" ? (progress ?? "Загружаем…") : hasPhotos ? "Добавить фото" : "Загрузить фото"}
          </label>

          {hasPhotos && (
            <button
              type="button"
              onClick={handleSend}
              disabled={working || !!sentAt}
              className="rounded-full bg-gold-500 px-5 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-gold-600 disabled:opacity-50"
            >
              {busy === "send"
                ? "Отправляем…"
                : sentAt
                  ? "Уже отправлено"
                  : photoUrls.length > 1
                    ? `Отправить клиенту (${photoUrls.length})`
                    : "Отправить клиенту"}
            </button>
          )}
        </div>

        {sentAt && (
          <p className="font-body text-xs text-green-700">
            Отправлено {sentFormatter.format(new Date(sentAt))}
          </p>
        )}
        {done && <p className="font-body text-xs text-green-700">{done}</p>}
        {error && <p className="max-w-prose font-body text-xs text-red-600">{error}</p>}
      </div>
    </section>
  );
}
