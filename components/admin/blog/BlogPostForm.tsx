"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createBlogPost,
  updateBlogPost,
  uploadBlogCover,
  uploadBlogImage,
  type AdminBlogPostDetail,
} from "@/lib/actions/blog";
import { slugify } from "@/lib/blog";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon, CloseIcon } from "@/components/ui/Icons";

type Errors = Partial<Record<"title" | "slug" | "content", string>>;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type BlogPostFormProps = {
  /** Есть — редактируем существующую статью, нет — создаём новую. */
  post?: AdminBlogPostDetail;
};

export function BlogPostForm({ post }: BlogPostFormProps) {
  const router = useRouter();
  const isEditing = !!post;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const contentImageInputRef = useRef<HTMLInputElement>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  // В режиме редактирования slug уже задан автором — не переписываем его
  // на лету при правке заголовка, как это удобно делать для новой статьи.
  const [slugTouched, setSlugTouched] = useState(isEditing);
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
  const [content, setContent] = useState(post?.content ?? "");
  const [seoTitle, setSeoTitle] = useState(post?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(post?.seoDescription ?? "");
  const [isPublished, setIsPublished] = useState(post?.isPublished ?? false);
  const [publishedAt, setPublishedAt] = useState(post?.publishedAt?.slice(0, 10) ?? todayIsoDate());

  const [coverImage, setCoverImage] = useState<string | null>(post?.coverImage ?? null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  const [galleryImages, setGalleryImages] = useState<string[]>(post?.galleryImages ?? []);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);

  const [contentImageUploading, setContentImageUploading] = useState(false);
  const [contentImageError, setContentImageError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting">("idle");

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(value);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setCoverUploading(true);
    setCoverError(null);

    const formData = new FormData();
    formData.append("file", file);

    const result = await uploadBlogCover(formData);
    setCoverUploading(false);

    if (!result.success) {
      setCoverError(result.error);
      return;
    }
    setCoverImage(result.data.url);
  }

  function removeCover() {
    setCoverImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleGalleryFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setGalleryUploading(true);
    setGalleryError(null);

    // Загружаем по одной: параллельные апловы на один и тот же бакет от
    // одного клика не дают выигрыша в UX (превью всё равно появляются по
    // мере готовности), зато проще откатиться на первой же ошибке.
    const uploaded: string[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadBlogImage(formData);
      if (!result.success) {
        setGalleryError(result.error);
        break;
      }
      uploaded.push(result.data.url);
    }

    if (uploaded.length > 0) {
      setGalleryImages((prev) => [...prev, ...uploaded]);
    }
    setGalleryUploading(false);
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  }

  function removeGalleryImage(index: number) {
    setGalleryImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleContentImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setContentImageUploading(true);
    setContentImageError(null);

    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadBlogImage(formData);

    setContentImageUploading(false);
    if (contentImageInputRef.current) contentImageInputRef.current.value = "";

    if (!result.success) {
      setContentImageError(result.error);
      return;
    }

    const snippet = `\n<p><img src="${result.data.url}" alt="" /></p>\n`;
    const textarea = contentTextareaRef.current;

    if (textarea) {
      const cursor = textarea.selectionStart ?? content.length;
      const next = content.slice(0, cursor) + snippet + content.slice(cursor);
      setContent(next);
      // Курсор — сразу после вставленного фрагмента, чтобы можно было
      // продолжать печатать текст, не перетаскивая курсор вручную.
      requestAnimationFrame(() => {
        textarea.focus();
        const pos = cursor + snippet.length;
        textarea.setSelectionRange(pos, pos);
      });
    } else {
      setContent((prev) => prev + snippet);
    }
  }

  function validate(): boolean {
    const next: Errors = {};
    if (!title.trim()) next.title = "Укажите заголовок";
    if (!slug.trim()) next.slug = "Укажите URL-адрес";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
      next.slug = "Только латиница, цифры и дефисы";
    }
    if (!content.trim()) next.content = "Заполните текст статьи";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (status === "submitting") return;
    if (!validate()) return;

    setStatus("submitting");
    setFormError(null);

    const payload = {
      title: title.trim(),
      slug: slug.trim(),
      excerpt,
      content,
      coverImage,
      galleryImages,
      seoTitle,
      seoDescription,
      isPublished,
      publishedAt,
    };

    const result = isEditing ? await updateBlogPost(post.id, payload) : await createBlogPost(payload);

    if (!result.success) {
      setFormError(result.error);
      setStatus("idle");
      return;
    }

    router.push("/admin/blog");
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
          <FormField label="Заголовок" htmlFor="postTitle" required error={errors.title}>
            <input
              id="postTitle"
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Например: Как продлить жизнь букету"
              className={inputClass(!!errors.title)}
            />
          </FormField>

          <FormField
            label="URL-адрес (slug)"
            htmlFor="postSlug"
            required
            error={errors.slug}
            hint={!errors.slug ? `floria.ru/blog/${slug || "..."}` : undefined}
          >
            <input
              id="postSlug"
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="kak-prodlit-zhizn-buketu"
              className={inputClass(!!errors.slug)}
            />
          </FormField>

          <FormField label="Краткое описание" htmlFor="postExcerpt" hint="Показывается в карточке статьи в списке блога">
            <textarea
              id="postExcerpt"
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={3}
              placeholder="Пара предложений, которые зацепят читателя"
              className={`${inputClass()} resize-none`}
            />
          </FormField>
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Обложка</h2>

        <div className="mt-5">
          {coverImage ? (
            <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-lavender-100">
              {/* Внешние URL из Supabase Storage — next/image потребовал бы
                  настройки remotePatterns под конкретный проект, обычный img
                  проще и надёжнее для админ-загрузки */}
              <img src={coverImage} alt="Обложка статьи" className="aspect-video w-full object-cover" />
              <button
                type="button"
                onClick={removeCover}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/60 text-white transition hover:bg-ink/80"
                aria-label="Удалить обложку"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label
              htmlFor="postCover"
              className="flex w-full max-w-sm cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-lavender-300 bg-lavender-50 px-4 py-10 text-center transition hover:bg-lavender-100"
            >
              <span className="font-body text-sm font-medium text-ink/70">
                {coverUploading ? "Загружаем..." : "Нажмите, чтобы выбрать изображение"}
              </span>
              <span className="font-body text-xs text-ink/40">JPG, PNG — до 5 МБ</span>
            </label>
          )}

          <input
            ref={fileInputRef}
            id="postCover"
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            disabled={coverUploading}
            className="sr-only"
          />

          {coverError && <p className="mt-2 font-body text-xs text-red-600">{coverError}</p>}
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Галерея</h2>
        <p className="mt-1 font-body text-xs text-ink/50">
          Несколько фото — на странице статьи покажутся плавной каруселью, отдельно от обложки
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          {galleryImages.map((url, index) => (
            <div key={url} className="relative h-24 w-24 overflow-hidden rounded-xl border border-lavender-100">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeGalleryImage(index)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/60 text-white transition hover:bg-ink/80"
                aria-label="Удалить фото из галереи"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </div>
          ))}

          <label
            htmlFor="postGallery"
            className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-lavender-300 bg-lavender-50 text-center transition hover:bg-lavender-100"
          >
            <span className="font-body text-[11px] font-medium leading-tight text-ink/60 px-1">
              {galleryUploading ? "Грузим..." : "+ Добавить"}
            </span>
          </label>
          <input
            ref={galleryInputRef}
            id="postGallery"
            type="file"
            accept="image/*"
            multiple
            onChange={handleGalleryFilesChange}
            disabled={galleryUploading}
            className="sr-only"
          />
        </div>

        {galleryError && <p className="mt-2 font-body text-xs text-red-600">{galleryError}</p>}
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">Контент</h2>
            <p className="mt-1 font-body text-xs text-ink/50">
              Базовый HTML: &lt;h2&gt;, &lt;p&gt;, &lt;ul&gt;, &lt;li&gt;, &lt;strong&gt;, &lt;a&gt;
            </p>
          </div>

          <label
            htmlFor="postContentImage"
            className="cursor-pointer whitespace-nowrap rounded-full border border-lavender-200 px-4 py-2 font-body text-xs font-medium text-ink/70 transition hover:border-gold-400 hover:text-gold-700"
          >
            {contentImageUploading ? "Загружаем..." : "+ Вставить фото в текст"}
          </label>
          <input
            ref={contentImageInputRef}
            id="postContentImage"
            type="file"
            accept="image/*"
            onChange={handleContentImageChange}
            disabled={contentImageUploading}
            className="sr-only"
          />
        </div>

        {contentImageError && <p className="mt-2 font-body text-xs text-red-600">{contentImageError}</p>}

        <div className="mt-4">
          <FormField label="Текст статьи" htmlFor="postContent" required error={errors.content}>
            <textarea
              ref={contentTextareaRef}
              id="postContent"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={16}
              placeholder={"<h2>Заголовок раздела</h2>\n<p>Текст абзаца...</p>\n<p><img src=\"...\" alt=\"\" /></p>"}
              className={`${inputClass(!!errors.content)} font-mono text-xs leading-relaxed resize-y`}
            />
          </FormField>
          <p className="mt-1.5 font-body text-xs text-ink/40">
            Курсор в тексте определяет, куда встанет фото — поставьте его между абзацами и нажмите «Вставить фото в текст», получится чередование текст/фото/текст/фото
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">SEO</h2>

        <div className="mt-5 flex flex-col gap-4">
          <FormField label="SEO Title" htmlFor="postSeoTitle" hint="Если не заполнить, используется заголовок статьи">
            <input
              id="postSeoTitle"
              type="text"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              className={inputClass()}
            />
          </FormField>

          <FormField label="SEO Description" htmlFor="postSeoDescription">
            <textarea
              id="postSeoDescription"
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              rows={2}
              className={`${inputClass()} resize-none`}
            />
          </FormField>
        </div>
      </div>

      <div className="flex flex-col gap-5 rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={isPublished}
              onClick={() => setIsPublished((v) => !v)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                isPublished ? "bg-gold-500" : "bg-lavender-200"
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition ${
                  isPublished ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
            <div>
              <span className="block font-display text-sm font-semibold text-ink">
                {isEditing ? "Опубликовано" : "Опубликовать сразу"}
              </span>
              <span className="block font-body text-xs text-ink/50">
                {isPublished ? "Статья видна в блоге" : "Сохранится как черновик"}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={status === "submitting" || coverUploading || galleryUploading || contentImageUploading}
            className="flex items-center justify-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {status === "submitting"
              ? "Сохраняем..."
              : isEditing
              ? "Сохранить изменения"
              : isPublished
              ? "Опубликовать"
              : "Сохранить черновик"}
            {status !== "submitting" && <ArrowRightIcon className="h-4 w-4" />}
          </button>
        </div>

        {isPublished && (
          <div className="border-t border-lavender-100 pt-5">
            <FormField
              label="Дата публикации"
              htmlFor="postPublishedAt"
              hint="По умолчанию сегодня — поменяйте при переносе старой статьи, чтобы дата в блоге совпадала с оригиналом"
            >
              <input
                id="postPublishedAt"
                type="date"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
                max={todayIsoDate()}
                className={`${inputClass()} max-w-[200px]`}
              />
            </FormField>
          </div>
        )}
      </div>
    </div>
  );
}
