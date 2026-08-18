"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createProduct,
  updateProduct,
  uploadProductImage,
  type AdminCategory,
  type AdminProductDetail,
} from "@/lib/actions/catalog";
import { slugify } from "@/lib/blog";
import type { OccasionOption } from "@/lib/occasions";
import type { AvailabilityMode, Occasion, ProductSize } from "@/lib/products";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon, CloseIcon } from "@/components/ui/Icons";

type Errors = Partial<Record<"name" | "slug" | "categoryId" | "price", string>>;

function randomSizeId(): string {
  return Math.random().toString(36).slice(2, 8);
}

const DEFAULT_SIZE: ProductSize = { id: "std", label: "Стандарт", priceModifier: 0 };

type ProductFormProps = {
  categories: AdminCategory[];
  occasions: OccasionOption[];
  /** Есть — редактируем существующий товар, нет — создаём новый. */
  product?: AdminProductDetail;
};

export function ProductForm({ categories, occasions, product }: ProductFormProps) {
  const router = useRouter();
  const isEditing = !!product;

  const imagesInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEditing);
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [oldPrice, setOldPrice] = useState(product?.oldPrice != null ? String(product.oldPrice) : "");
  const [stockQuantity, setStockQuantity] = useState(product ? String(product.stockQuantity) : "0");
  const [availabilityMode, setAvailabilityMode] = useState<AvailabilityMode>(
    product?.availabilityMode ?? "in_stock"
  );
  const [isActive, setIsActive] = useState(product?.isActive ?? true);

  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [imagesUploading, setImagesUploading] = useState(false);
  const [imagesError, setImagesError] = useState<string | null>(null);

  const [selectedOccasions, setSelectedOccasions] = useState<Set<Occasion>>(new Set(product?.occasions ?? []));
  const [composition, setComposition] = useState<string[]>(
    product?.composition && product.composition.length > 0 ? product.composition : [""]
  );
  const [sizes, setSizes] = useState<(ProductSize & { key: string })[]>(
    (product?.sizes && product.sizes.length > 0 ? product.sizes : [DEFAULT_SIZE]).map((s) => ({
      ...s,
      key: randomSizeId(),
    }))
  );

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

  async function handleImagesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setImagesUploading(true);
    setImagesError(null);

    const uploaded: string[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadProductImage(formData);
      if (!result.success) {
        setImagesError(result.error);
        break;
      }
      uploaded.push(result.data.url);
    }

    if (uploaded.length > 0) setImages((prev) => [...prev, ...uploaded]);
    setImagesUploading(false);
    if (imagesInputRef.current) imagesInputRef.current.value = "";
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleOccasion(occasion: Occasion) {
    setSelectedOccasions((prev) => {
      const next = new Set(prev);
      next.has(occasion) ? next.delete(occasion) : next.add(occasion);
      return next;
    });
  }

  function updateComposition(index: number, value: string) {
    setComposition((prev) => prev.map((c, i) => (i === index ? value : c)));
  }

  function addCompositionRow() {
    setComposition((prev) => [...prev, ""]);
  }

  function removeCompositionRow(index: number) {
    setComposition((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSize(key: string, field: keyof ProductSize, value: string) {
    setSizes((prev) =>
      prev.map((s) =>
        s.key === key
          ? { ...s, [field]: field === "priceModifier" ? Number(value) || 0 : value }
          : s
      )
    );
  }

  function addSize() {
    setSizes((prev) => [...prev, { id: "", label: "", priceModifier: 0, key: randomSizeId() }]);
  }

  function removeSize(key: string) {
    setSizes((prev) => (prev.length > 1 ? prev.filter((s) => s.key !== key) : prev));
  }

  function validate(): boolean {
    const next: Errors = {};
    if (!name.trim()) next.name = "Укажите название";
    if (!slug.trim()) next.slug = "Укажите URL-адрес";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
      next.slug = "Только латиница, цифры и дефисы";
    }
    if (!categoryId) next.categoryId = "Выберите категорию";
    const priceNumber = Number(price);
    if (!price || !Number.isFinite(priceNumber) || priceNumber <= 0) {
      next.price = "Укажите цену больше нуля";
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
      categoryId,
      description,
      price: Number(price),
      oldPrice: oldPrice ? Number(oldPrice) : null,
      stockQuantity: Number(stockQuantity) || 0,
      availabilityMode,
      isActive,
      images,
      occasions: Array.from(selectedOccasions),
      composition: composition.map((c) => c.trim()).filter(Boolean),
      sizes: sizes
        .filter((s) => s.id.trim() && s.label.trim())
        .map(({ id, label, priceModifier }) => ({ id: id.trim(), label: label.trim(), priceModifier })),
    };

    if (payload.sizes.length === 0) {
      setFormError("Заполните хотя бы один размер (ID и название)");
      setStatus("idle");
      return;
    }

    const result = isEditing ? await updateProduct(product.id, payload) : await createProduct(payload);

    if (!result.success) {
      setFormError(result.error);
      setStatus("idle");
      return;
    }

    router.push("/admin/catalog");
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
          <FormField label="Название" htmlFor="productName" required error={errors.name}>
            <input
              id="productName"
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Например: Букет невесты «Классика»"
              className={inputClass(!!errors.name)}
            />
          </FormField>

          <FormField
            label="URL-адрес (slug)"
            htmlFor="productSlug"
            required
            error={errors.slug}
            hint={!errors.slug ? `floria.ru/catalog/${slug || "..."}` : undefined}
          >
            <input
              id="productSlug"
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="buket-nevesty-klassika"
              className={inputClass(!!errors.slug)}
            />
          </FormField>

          <FormField label="Категория" htmlFor="productCategory" required error={errors.categoryId}>
            <select
              id="productCategory"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={inputClass(!!errors.categoryId)}
            >
              {categories.length === 0 && <option value="">Нет категорий</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Описание" htmlFor="productDescription">
            <textarea
              id="productDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Пара предложений о букете — что в составе, для какого повода"
              className={`${inputClass()} resize-none`}
            />
          </FormField>
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Наличие</h2>
        <p className="mt-1 font-body text-xs text-ink/50">
          «В наличии» — уже собран или можно собрать из остатков на складе прямо сейчас. «Под заказ» — в основном
          свадебная флористика, которая собирается только после оформления заказа.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {(["in_stock", "made_to_order"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAvailabilityMode(mode)}
              className={`rounded-full border px-4 py-2 font-display text-sm font-medium transition ${
                availabilityMode === mode
                  ? "border-gold-500 bg-gold-500 text-white"
                  : "border-lavender-200 bg-white text-ink/70 hover:border-gold-300"
              }`}
            >
              {mode === "in_stock" ? "В наличии" : "Под заказ"}
            </button>
          ))}
        </div>

        {availabilityMode === "in_stock" && (
          <div className="mt-5 max-w-[200px]">
            <FormField label="Остаток на складе, шт." htmlFor="productStock">
              <input
                id="productStock"
                type="number"
                inputMode="numeric"
                min={0}
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                className={inputClass()}
              />
            </FormField>
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Цена</h2>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Цена, ₽" htmlFor="productPrice" required error={errors.price}>
            <input
              id="productPrice"
              type="number"
              inputMode="numeric"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={inputClass(!!errors.price)}
            />
          </FormField>

          <FormField label="Старая цена, ₽" htmlFor="productOldPrice" hint="Заполните, если действует скидка">
            <input
              id="productOldPrice"
              type="number"
              inputMode="numeric"
              min={0}
              value={oldPrice}
              onChange={(e) => setOldPrice(e.target.value)}
              className={inputClass()}
            />
          </FormField>
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Фото</h2>

        <div className="mt-5 flex flex-wrap gap-3">
          {images.map((url, index) => (
            <div key={url} className="relative h-24 w-24 overflow-hidden rounded-xl border border-lavender-100">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/60 text-white transition hover:bg-ink/80"
                aria-label="Удалить фото"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </div>
          ))}

          <label
            htmlFor="productImages"
            className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-lavender-300 bg-lavender-50 text-center transition hover:bg-lavender-100"
          >
            <span className="font-body text-[11px] font-medium leading-tight text-ink/60 px-1">
              {imagesUploading ? "Грузим..." : "+ Добавить"}
            </span>
          </label>
          <input
            ref={imagesInputRef}
            id="productImages"
            type="file"
            accept="image/*"
            multiple
            onChange={handleImagesChange}
            disabled={imagesUploading}
            className="sr-only"
          />
        </div>
        {imagesError && <p className="mt-2 font-body text-xs text-red-600">{imagesError}</p>}
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Повод</h2>
        {occasions.length === 0 && (
          <p className="mt-1 font-body text-xs text-ink/50">
            Поводов ещё нет — добавьте их в /admin/occasions
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {occasions.map((occasion) => {
            const active = selectedOccasions.has(occasion.name);
            return (
              <button
                key={occasion.id}
                type="button"
                onClick={() => toggleOccasion(occasion.name)}
                className={`rounded-full border px-3.5 py-1.5 font-body text-sm transition ${
                  active
                    ? "border-gold-500 bg-gold-500 text-white"
                    : "border-lavender-200 bg-white text-ink/70 hover:border-gold-300"
                }`}
              >
                {occasion.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Состав</h2>
        <div className="mt-4 flex flex-col gap-2.5">
          {composition.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={line}
                onChange={(e) => updateComposition(index, e.target.value)}
                placeholder="Например: Роза белая — 9 шт"
                className={inputClass()}
              />
              <button
                type="button"
                onClick={() => removeCompositionRow(index)}
                aria-label="Удалить строку состава"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-100 hover:text-red-600"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addCompositionRow}
            className="self-start font-body text-sm text-gold-600 underline underline-offset-4"
          >
            + Добавить строку
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Размеры</h2>
        <p className="mt-1 font-body text-xs text-ink/50">
          Доплата — на сколько рублей размер дороже базовой цены (0 для стандартного)
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {sizes.map((size) => (
            <div key={size.key} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={size.id}
                onChange={(e) => updateSize(size.key, "id", e.target.value)}
                placeholder="id (s, m, l)"
                className={`${inputClass()} w-24`}
              />
              <input
                type="text"
                value={size.label}
                onChange={(e) => updateSize(size.key, "label", e.target.value)}
                placeholder="Название (S, M, L)"
                className={`${inputClass()} w-36`}
              />
              <input
                type="number"
                value={size.priceModifier}
                onChange={(e) => updateSize(size.key, "priceModifier", e.target.value)}
                placeholder="Доплата, ₽"
                className={`${inputClass()} w-32`}
              />
              <button
                type="button"
                onClick={() => removeSize(size.key)}
                disabled={sizes.length === 1}
                aria-label="Удалить размер"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-100 hover:text-red-600 disabled:opacity-30"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addSize}
            className="self-start font-body text-sm text-gold-600 underline underline-offset-4"
          >
            + Добавить размер
          </button>
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
            <span className="block font-display text-sm font-semibold text-ink">Показывать в каталоге</span>
            <span className="block font-body text-xs text-ink/50">
              {isActive ? "Виден на витрине" : "Скрыт от покупателей"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={status === "submitting" || imagesUploading}
          className="flex items-center justify-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "submitting" ? "Сохраняем..." : isEditing ? "Сохранить изменения" : "Добавить букет"}
          {status !== "submitting" && <ArrowRightIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
