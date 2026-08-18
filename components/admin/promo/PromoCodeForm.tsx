"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPromoCode, updatePromoCode, type AdminPromoCode, type PromoCodeInput } from "@/lib/actions/promo-codes";
import { FormField } from "@/components/ui/FormField";
import { inputClass } from "@/components/ui/input-styles";
import { ArrowRightIcon } from "@/components/ui/Icons";

type Errors = Partial<Record<"code" | "discountValue", string>>;

type PromoCodeFormProps = {
  promoCode?: AdminPromoCode;
};

export function PromoCodeForm({ promoCode }: PromoCodeFormProps) {
  const router = useRouter();
  const isEditing = !!promoCode;

  const [code, setCode] = useState(promoCode?.code ?? "");
  const [description, setDescription] = useState(promoCode?.description ?? "");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(promoCode?.discountType ?? "percent");
  const [discountValue, setDiscountValue] = useState(promoCode ? String(promoCode.discountValue) : "");
  const [minOrderAmount, setMinOrderAmount] = useState(promoCode ? String(promoCode.minOrderAmount) : "0");
  const [maxUses, setMaxUses] = useState(promoCode?.maxUses != null ? String(promoCode.maxUses) : "");
  const [maxUsesPerCustomer, setMaxUsesPerCustomer] = useState(
    promoCode?.maxUsesPerCustomer != null ? String(promoCode.maxUsesPerCustomer) : "1"
  );
  const [validFrom, setValidFrom] = useState(promoCode?.validFrom?.slice(0, 10) ?? "");
  const [validUntil, setValidUntil] = useState(promoCode?.validUntil?.slice(0, 10) ?? "");
  const [isActive, setIsActive] = useState(promoCode?.isActive ?? true);

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting">("idle");

  function validate(): boolean {
    const next: Errors = {};
    if (!code.trim()) next.code = "Укажите код";
    const value = Number(discountValue);
    if (!discountValue || !Number.isFinite(value) || value <= 0) {
      next.discountValue = "Укажите скидку больше нуля";
    } else if (discountType === "percent" && value > 100) {
      next.discountValue = "Не больше 100%";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (status === "submitting") return;
    if (!validate()) return;

    setStatus("submitting");
    setFormError(null);

    const payload: PromoCodeInput = {
      code: code.trim().toUpperCase(),
      description,
      discountType,
      discountValue: Number(discountValue),
      minOrderAmount: Number(minOrderAmount) || 0,
      maxUses: maxUses.trim() ? Number(maxUses) : null,
      maxUsesPerCustomer: maxUsesPerCustomer.trim() ? Number(maxUsesPerCustomer) : null,
      validFrom: validFrom || null,
      validUntil: validUntil || null,
      isActive,
    };

    const result = isEditing ? await updatePromoCode(promoCode.id, payload) : await createPromoCode(payload);

    if (!result.success) {
      setFormError(result.error);
      setStatus("idle");
      return;
    }

    router.push("/admin/promo-codes");
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
          <FormField label="Код" htmlFor="promoCode" required error={errors.code} hint="Клиент вводит его при оформлении заказа, регистр не важен">
            <input
              id="promoCode"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="LETO2026"
              className={`${inputClass(!!errors.code)} uppercase`}
            />
          </FormField>

          <FormField label="Заметка для себя" htmlFor="promoDescription" hint="Не показывается клиенту">
            <input
              id="promoDescription"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Например: летняя рассылка в Telegram"
              className={inputClass()}
            />
          </FormField>
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Скидка</h2>

        <div className="mt-4 flex flex-wrap gap-3">
          {(["percent", "fixed"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDiscountType(mode)}
              className={`rounded-full border px-4 py-2 font-display text-sm font-medium transition ${
                discountType === mode
                  ? "border-gold-500 bg-gold-500 text-white"
                  : "border-lavender-200 bg-white text-ink/70 hover:border-gold-300"
              }`}
            >
              {mode === "percent" ? "Процент" : "Фиксированная сумма"}
            </button>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label={discountType === "percent" ? "Скидка, %" : "Скидка, ₽"}
            htmlFor="promoDiscountValue"
            required
            error={errors.discountValue}
          >
            <input
              id="promoDiscountValue"
              type="number"
              inputMode="numeric"
              min={0}
              max={discountType === "percent" ? 100 : undefined}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              className={inputClass(!!errors.discountValue)}
            />
          </FormField>

          <FormField label="Минимальная сумма заказа, ₽" htmlFor="promoMinOrder" hint="0 — без минимума">
            <input
              id="promoMinOrder"
              type="number"
              inputMode="numeric"
              min={0}
              value={minOrderAmount}
              onChange={(e) => setMinOrderAmount(e.target.value)}
              className={inputClass()}
            />
          </FormField>
        </div>
      </div>

      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Ограничения</h2>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Лимит использований всего" htmlFor="promoMaxUses" hint="Пусто — без лимита">
            <input
              id="promoMaxUses"
              type="number"
              inputMode="numeric"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Без лимита"
              className={inputClass()}
            />
          </FormField>

          <FormField label="Лимит на одного клиента" htmlFor="promoMaxUsesPerCustomer" hint="Пусто — без лимита">
            <input
              id="promoMaxUsesPerCustomer"
              type="number"
              inputMode="numeric"
              min={1}
              value={maxUsesPerCustomer}
              onChange={(e) => setMaxUsesPerCustomer(e.target.value)}
              placeholder="Без лимита"
              className={inputClass()}
            />
          </FormField>

          <FormField label="Действует с" htmlFor="promoValidFrom" hint="Пусто — действует сразу">
            <input
              id="promoValidFrom"
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              className={inputClass()}
            />
          </FormField>

          <FormField label="Действует по" htmlFor="promoValidUntil" hint="Пусто — бессрочно">
            <input
              id="promoValidUntil"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className={inputClass()}
            />
          </FormField>
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
            <span className="block font-display text-sm font-semibold text-ink">Промокод активен</span>
            <span className="block font-body text-xs text-ink/50">
              {isActive ? "Можно применить при оформлении" : "Не принимается"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={status === "submitting"}
          className="flex items-center justify-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "submitting" ? "Сохраняем..." : isEditing ? "Сохранить изменения" : "Создать промокод"}
          {status !== "submitting" && <ArrowRightIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
