"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCategory,
  updateCategory,
  uploadCategoryImage,
  type AdminCategoryDetail,
} from "@/lib/actions/categories";
import { slugify } from "@/lib/blog";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon, CloseIcon } from "@/components/ui/Icons";

type Errors = Partial<Record<"name" | "slug", string>>;

type CategoryFormProps = {
  category?: AdminCategoryDetail;
  /** Следующий по порядку sort_order — подставляется для новой категории. */
  nextSortOrder?: number;
};

export function CategoryForm({ category, nextSortOrder }: CategoryFormProps) {
  const router = useRouter();
  const isEditing = !!category;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEditing);
  const [subtitle, setSubtitle] = useState(category?.subtitle ?? "");
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? nextSortOrder ?? 0));
  const [isActive, setIsActive] = useState(category?.isActive ?? true);

  const [image, setImage] = useState<string | null>(category?.imageUrl ?? null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting">("idle");

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(value);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageUploading(true);
    setImageError(null);

    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadCategoryImage(formData);
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

  function validate(): boolean {
    const next: Errors = {};
    if (!name.trim()) next.name = "Укажите название";
    if (!slug.trim()) next.slug = "Укажите URL-адрес";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
      next.slug = "Только латиница, цифры и дефисы";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (status === "submitting") return;
    if (!validate()) return;

    setStatus("submitting");
    setFormError(null);

    const payload = {
      name: name.trim(),
      slug: slug.trim(),
      subtitle,
      imageUrl: image,
      sortOrder: Number(sortOrder) || 0,
      isActive,
    };

    const result = isEditing ? await updateCategory(category.id, payload) : await createCategory(payload);

    if (!result.success) {
      setFormError(result.error);
      setStatus("idle");
      return;
    }

    router.push("/admin/categories");
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

        <div className="mt-5 flex flex-col gap-4">
          <FormField label="Название" htmlFor="categoryName" required error={errors.name}>
            <input
              id="categoryName"
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Например: Тюльпаны к 8 марта"
              className={inputClass(!!errors.name)}
            />
          </FormField>

          <FormField
            label="URL-адрес (slug)"
            htmlFor="categorySlug"
            required
            error={errors.slug}
            hint={!errors.slug ? `floria.ru/catalog?category=${slug || "..."}` : undefined}
          >
            <input
              id="categorySlug"
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="tulpany-k-8-marta"
              className={inputClass(!!errors.slug)}
            />
          </FormField>

          <FormField label="Подзаголовок" htmlFor="categorySubtitle" hint="Короткая строка под названием на главной">
            <input
              id="categorySubtitle"
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Свежая срезка, сезонные сборы"
              className={inputClass()}
            />
          </FormField>

          <div className="max-w-[160px]">
            <FormField label="Порядок" htmlFor="categorySortOrder" hint="Меньше — выше в списке">
              <input
                id="categorySortOrder"
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
        <h2 className="font-display text-base font-semibold text-ink">Фото</h2>

        <div className="mt-5">
          {image ? (
            <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-lavender-100">
              <img src={image} alt="Фото категории" className="aspect-video w-full object-cover" />
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
              htmlFor="categoryImage"
              className="flex w-full max-w-sm cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-lavender-300 bg-lavender-50 px-4 py-10 text-center transition hover:bg-lavender-100"
            >
              <span className="font-body text-sm font-medium text-ink/70">
                {imageUploading ? "Загружаем..." : "Нажмите, чтобы выбрать изображение"}
              </span>
              <span className="font-body text-xs text-ink/40">JPG, PNG — до 5 МБ</span>
            </label>
          )}

          <input
            ref={fileInputRef}
            id="categoryImage"
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            disabled={imageUploading}
            className="sr-only"
          />
          {imageError && <p className="mt-2 font-body text-xs text-red-600">{imageError}</p>}
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
            <span className="block font-display text-sm font-semibold text-ink">Показывать на сайте</span>
            <span className="block font-body text-xs text-ink/50">
              {isActive ? "Видна на главной и в фильтре каталога" : "Скрыта от покупателей"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={status === "submitting" || imageUploading}
          className="flex items-center justify-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "submitting" ? "Сохраняем..." : isEditing ? "Сохранить изменения" : "Добавить категорию"}
          {status !== "submitting" && <ArrowRightIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
