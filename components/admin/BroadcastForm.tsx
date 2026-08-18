"use client";

import { useRef, useState } from "react";
import { sendBroadcast, uploadBroadcastImage, type BroadcastSummary } from "@/lib/actions/broadcast";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon, CloseIcon } from "@/components/ui/Icons";

const PHOTO_CAPTION_LIMIT = 1024;

export function BroadcastForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BroadcastSummary | null>(null);

  const [image, setImage] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageUploading(true);
    setImageError(null);

    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadBroadcastImage(formData);
    setImageUploading(false);

    if (!result.success) {
      setImageError(result.error);
      return;
    }
    setImage(result.data.url);
  }

  function removeImage() {
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const captionTooLong = !!image && message.length > PHOTO_CAPTION_LIMIT;

  async function handleSend() {
    if (status === "sending" || (!message.trim() && !image) || captionTooLong) return;
    if (!window.confirm("Отправить это сообщение всем подписчикам бота? Действие не отменить.")) return;

    setStatus("sending");
    setError(null);
    setResult(null);

    const response = await sendBroadcast(message, image);
    setStatus("idle");

    if (!response.success) {
      setError(response.error);
      return;
    }

    setResult(response.data);
    setMessage("");
    removeImage();
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

      <FormField label="Фото" htmlFor="broadcastImage" hint="Необязательно — текст станет подписью к фото">
        {image ? (
          <div className="relative w-full max-w-xs overflow-hidden rounded-2xl border border-lavender-100">
            <img src={image} alt="Фото рассылки" className="aspect-video w-full object-cover" />
            <button
              type="button"
              onClick={removeImage}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/60 text-white transition hover:bg-ink/80"
              aria-label="Удалить фото"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <label
            htmlFor="broadcastImage"
            className="flex w-full max-w-xs cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-lavender-300 bg-lavender-50 px-4 py-8 text-center transition hover:bg-lavender-100"
          >
            <span className="font-body text-sm font-medium text-ink/70">
              {imageUploading ? "Загружаем..." : "Нажмите, чтобы выбрать изображение"}
            </span>
            <span className="font-body text-xs text-ink/40">JPG, PNG — до 5 МБ</span>
          </label>
        )}

        <input
          ref={fileInputRef}
          id="broadcastImage"
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          disabled={imageUploading}
          className="sr-only"
        />
        {imageError && <p className="mt-2 font-body text-xs text-red-600">{imageError}</p>}
      </FormField>

      <div className="mt-5">
        <FormField
          label="Текст рассылки"
          htmlFor="broadcastMessage"
          error={captionTooLong ? `С фото текст ограничен ${PHOTO_CAPTION_LIMIT} символами` : undefined}
          hint={
            captionTooLong
              ? undefined
              : "Уйдёт всем, кто хотя бы раз нажал /start у бота-напоминальщика"
          }
        >
          <textarea
            id="broadcastMessage"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder={"Например: 🌷 Открыли предзаказы к 8 марта — успейте забронировать букет заранее!"}
            className={`${inputClass(captionTooLong)} resize-y`}
          />
        </FormField>
      </div>

      <button
        type="button"
        onClick={handleSend}
        disabled={status === "sending" || (!message.trim() && !image) || captionTooLong || imageUploading}
        className="mt-4 flex items-center justify-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {status === "sending" ? "Отправляем..." : "Отправить всем"}
        {status !== "sending" && <ArrowRightIcon className="h-4 w-4" />}
      </button>
    </div>
  );
}
