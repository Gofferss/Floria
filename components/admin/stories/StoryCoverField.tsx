"use client";

import { useEffect, useRef, useState } from "react";
import { prepareImageForUpload } from "@/lib/prepare-image";
import { uploadStoryImage } from "@/lib/actions/stories";
import { CoverCropper } from "@/components/admin/stories/CoverCropper";

// ================================================================
// Обложка кружка истории.
//
// Пока своей обложки нет, кружок показывает первый слайд и меняется вместе
// с ним. Своя обложка — это картинка с устройства или кадр любого слайда,
// обрезанные по кругу (см. CoverCropper).
// ================================================================

type StoryCoverFieldProps = {
  /** Своя обложка; null — берём первый слайд. */
  value: string | null;
  /** Что покажет кружок без своей обложки. */
  autoCover: string | null;
  /** Картинки слайдов — из них можно сделать обложку. */
  slides: string[];
  title: string;
  onChange: (url: string | null) => void;
  /** Пока рамка открыта, обложка не готова: иначе сохранение истории молча её потеряет. */
  onEditingChange: (editing: boolean) => void;
};

export function StoryCoverField({ value, autoCover, slides, title, onChange, onEditingChange }: StoryCoverFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = value ?? autoCover;
  const editing = source !== null || preparing;

  useEffect(() => {
    onEditingChange(editing);
  }, [editing, onEditingChange]);

  // Картинка с устройства живёт в памяти браузера, пока открыта рамка.
  useEffect(() => {
    if (!source?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(source);
  }, [source]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setError(null);
    setPreparing(true);
    const ready = await prepareImageForUpload(file);
    setPreparing(false);
    if (!ready.ok) {
      setError(ready.error);
      return;
    }
    setSource(URL.createObjectURL(ready.file));
  }

  async function handleCropped(blob: Blob) {
    setSaving(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", new File([blob], "cover.jpg", { type: "image/jpeg" }));
    const result = await uploadStoryImage(formData);
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onChange(result.data.url);
    setSource(null);
  }

  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
      <h2 className="font-display text-base font-semibold text-ink">Обложка кружка</h2>
      <p className="mt-1 font-body text-xs text-ink/50">
        Круг на главной. Без своей обложки показывается первый слайд.
      </p>

      <div className="mt-5 flex items-start gap-5">
        {/* Тот же вид, что на главной: кольцо, белый зазор, круг, подпись. */}
        <div className="flex w-24 shrink-0 flex-col items-center gap-2">
          <span className="block h-[84px] w-[84px] rounded-full bg-gradient-to-br from-gold-400 via-gold-300 to-lavender-500 p-[2.5px]">
            <span className="block h-full w-full rounded-full bg-white p-[2px]">
              <span className="block h-full w-full overflow-hidden rounded-full">
                {shown ? (
                  <img src={shown} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="block h-full w-full bg-lavender-100" />
                )}
              </span>
            </span>
          </span>
          <span className="line-clamp-2 text-center font-display text-[10px] font-semibold uppercase leading-tight tracking-wide text-ink/70">
            {title.trim() || "Название"}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <label
              htmlFor="storyCoverUpload"
              className="cursor-pointer rounded-full bg-gold-500 px-5 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-gold-600"
            >
              {preparing ? "Открываем…" : "Загрузить картинку"}
            </label>
            <input
              ref={fileRef}
              id="storyCoverUpload"
              type="file"
              accept="image/*,.heic,.heif"
              onChange={handleFile}
              disabled={preparing || saving}
              className="sr-only"
            />
            {shown && !source && (
              <button
                type="button"
                onClick={() => setSource(shown)}
                className="rounded-full border border-lavender-200 bg-white px-5 py-2.5 font-display text-sm font-medium text-ink/70 transition hover:border-gold-300"
              >
                Подвинуть
              </button>
            )}
            {value && !source && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="rounded-full px-3 py-2.5 font-body text-sm text-ink/50 underline decoration-lavender-300 underline-offset-2 transition hover:text-ink"
              >
                Вернуть первый слайд
              </button>
            )}
          </div>

          {slides.length > 0 && (
            <div>
              <span className="block font-body text-xs text-ink/50">Или возьмите кадр из слайда</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {slides.map((url, i) => (
                  <button
                    key={url + i}
                    type="button"
                    onClick={() => {
                      setError(null);
                      setSource(url);
                    }}
                    aria-label={`Сделать обложку из слайда ${i + 1}`}
                    className="h-14 w-14 overflow-hidden rounded-xl ring-1 ring-lavender-200 transition hover:ring-2 hover:ring-gold-400"
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="font-body text-xs text-red-600">{error}</p>}
        </div>
      </div>

      {source && (
        <div className="mt-5">
          <CoverCropper src={source} busy={saving} onCancel={() => setSource(null)} onDone={handleCropped} />
        </div>
      )}
    </div>
  );
}
