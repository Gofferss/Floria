"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createStory,
  updateStory,
  uploadStoryImage,
  type AdminStoryDetail,
  type StoryItemInput,
} from "@/lib/actions/stories";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon, CloseIcon } from "@/components/ui/Icons";

const DEFAULT_DURATION = 5;

type StoryFormProps = {
  story?: AdminStoryDetail;
  nextSortOrder?: number;
};

export function StoryForm({ story, nextSortOrder }: StoryFormProps) {
  const router = useRouter();
  const isEditing = !!story;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(story?.title ?? "");
  const [sortOrder, setSortOrder] = useState(String(story?.sortOrder ?? nextSortOrder ?? 0));
  const [isActive, setIsActive] = useState(story?.isActive ?? true);
  const [items, setItems] = useState<StoryItemInput[]>(story?.items ?? []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting">("idle");

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploading(true);
    setUploadError(null);

    const uploaded: StoryItemInput[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadStoryImage(formData);
      if (!result.success) {
        setUploadError(result.error);
        break;
      }
      uploaded.push({ imageUrl: result.data.url, durationSeconds: DEFAULT_DURATION });
    }

    if (uploaded.length > 0) setItems((prev) => [...prev, ...uploaded]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function moveItem(index: number, direction: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function updateDuration(index: number, value: string) {
    const seconds = Math.max(1, Number(value) || DEFAULT_DURATION);
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, durationSeconds: seconds } : item)));
  }

  async function handleSubmit() {
    if (status === "submitting") return;

    let hasError = false;
    if (!title.trim()) {
      setTitleError("Укажите название");
      hasError = true;
    } else {
      setTitleError(null);
    }
    if (items.length === 0) {
      setFormError("Добавьте хотя бы одно фото");
      hasError = true;
    } else {
      setFormError(null);
    }
    if (hasError) return;

    setStatus("submitting");

    const payload = {
      title: title.trim(),
      coverImage: null,
      sortOrder: Number(sortOrder) || 0,
      isActive,
      items,
    };

    const result = isEditing ? await updateStory(story.id, payload) : await createStory(payload);

    if (!result.success) {
      setFormError(result.error);
      setStatus("idle");
      return;
    }

    router.push("/admin/stories");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {formError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Основное</h2>

        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="flex-1">
            <FormField label="Название" htmlFor="storyTitle" required error={titleError ?? undefined} hint="Подпись под кружком, например «Как нас найти»">
              <input
                id="storyTitle"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Как нас найти"
                className={inputClass(!!titleError)}
              />
            </FormField>
          </div>
          <div className="w-full sm:w-40">
            <FormField label="Порядок" htmlFor="storySortOrder" hint="Меньше — левее">
              <input
                id="storySortOrder"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className={inputClass()}
              />
            </FormField>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Слайды</h2>
        <p className="mt-1 font-body text-xs text-ink/50">
          Показываются по порядку сверху вниз. «Секунды» — сколько слайд виден, прежде чем переключится следующий.
        </p>

        <div className="mt-5 flex flex-col gap-3">
          {items.map((item, index) => (
            <div key={item.imageUrl + index} className="flex items-center gap-3 rounded-2xl border border-lavender-100 p-3">
              <img src={item.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
              <div className="flex flex-1 items-center gap-2">
                <span className="font-body text-xs text-ink/50">Слайд {index + 1}</span>
                <input
                  type="number"
                  min={1}
                  value={item.durationSeconds}
                  onChange={(e) => updateDuration(index, e.target.value)}
                  className={`${inputClass()} w-20`}
                />
                <span className="font-body text-xs text-ink/50">сек</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveItem(index, -1)}
                  disabled={index === 0}
                  aria-label="Сдвинуть раньше"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-100 hover:text-ink disabled:opacity-20"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label="Сдвинуть позже"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-100 hover:text-ink disabled:opacity-20"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  aria-label="Удалить слайд"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-100 hover:text-red-600"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          <label
            htmlFor="storyItemUpload"
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-lavender-300 bg-lavender-50 px-4 py-8 text-center transition hover:bg-lavender-100"
          >
            <span className="font-body text-sm font-medium text-ink/70">
              {uploading ? "Загружаем..." : "Нажмите, чтобы добавить фото"}
            </span>
            <span className="font-body text-xs text-ink/40">Можно выбрать сразу несколько — JPG, PNG, до 5 МБ каждое</span>
          </label>
          <input
            ref={fileInputRef}
            id="storyItemUpload"
            type="file"
            accept="image/*"
            multiple
            onChange={handleFilesChange}
            disabled={uploading}
            className="sr-only"
          />
          {uploadError && <p className="font-body text-xs text-red-600">{uploadError}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-5 rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => setIsActive((v) => !v)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${
              isActive ? "bg-gold-500" : "bg-lavender-200"
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition ${
                isActive ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
          <div>
            <span className="block font-display text-sm font-semibold text-ink">Показывать на главной</span>
            <span className="block font-body text-xs text-ink/50">
              {isActive ? "Виден в ленте сторис" : "Скрыт от посетителей"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={status === "submitting" || uploading}
          className="flex items-center justify-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "submitting" ? "Сохраняем..." : isEditing ? "Сохранить изменения" : "Создать историю"}
          {status !== "submitting" && <ArrowRightIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
