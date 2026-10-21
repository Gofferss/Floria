import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { listPromoCodesAdmin, deletePromoCode } from "@/lib/actions/promo-codes";
import { ArrowRightIcon, EditIcon } from "@/components/ui/Icons";
import { ToggleActiveButton } from "@/components/admin/promo/ToggleActiveButton";
import { DeleteButton } from "@/components/admin/DeleteButton";

export const metadata: Metadata = {
  title: "Промокоды — Админка Floria",
};

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

function discountLabel(code: { discountType: string; discountValue: number }): string {
  return code.discountType === "percent" ? `${code.discountValue}%` : `${code.discountValue} ₽`;
}

function periodLabel(validFrom: string | null, validUntil: string | null): string {
  if (!validFrom && !validUntil) return "Бессрочно";
  const from = validFrom ? dateFormatter.format(new Date(validFrom)) : "…";
  const until = validUntil ? dateFormatter.format(new Date(validUntil)) : "…";
  return `${from} — ${until}`;
}

export default async function AdminPromoCodesPage() {
  await requireStaffUser();
  const promoCodes = await listPromoCodesAdmin();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
            Админка
          </span>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Промокоды</h1>
        </div>

        <Link
          href="/admin/promo-codes/new"
          className="flex items-center gap-2 rounded-full bg-gold-500 px-6 py-3.5 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600"
        >
          Создать промокод
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>

      {promoCodes.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-lavender-200 px-6 py-20 text-center">
          <p className="font-display text-lg font-semibold text-ink">Пока нет ни одного промокода</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-lavender-100 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-lavender-100 bg-lavender-50/60">
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Код
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Скидка
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Период
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Использован
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Статус
                  </th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody>
                {promoCodes.map((promo) => (
                  <tr
                    key={promo.id}
                    className="border-b border-lavender-50 transition last:border-0 hover:bg-lavender-50/50"
                  >
                    <td className="px-5 py-4">
                      <Link href={`/admin/promo-codes/${promo.id}/edit`} className="group block">
                        <span className="block font-display text-sm font-semibold text-ink transition group-hover:text-gold-600">
                          {promo.code}
                        </span>
                        {promo.description && (
                          <span className="mt-0.5 block font-body text-xs text-ink/40">{promo.description}</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-5 py-4 font-body text-sm text-ink/60">{discountLabel(promo)}</td>
                    <td className="px-5 py-4 font-body text-sm text-ink/60">
                      {periodLabel(promo.validFrom, promo.validUntil)}
                    </td>
                    <td className="px-5 py-4 font-body text-sm text-ink/60">
                      {promo.timesUsed}
                      {promo.maxUses ? ` из ${promo.maxUses}` : ""}
                    </td>
                    <td className="px-5 py-4">
                      {promo.isActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 font-body text-xs font-medium text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                          Активен
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-lavender-100 px-3 py-1 font-body text-xs font-medium text-ink/60">
                          <span className="h-1.5 w-1.5 rounded-full bg-ink/30" aria-hidden="true" />
                          Выключен
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <ToggleActiveButton promoCodeId={promo.id} isActive={promo.isActive} />
                        <Link
                          href={`/admin/promo-codes/${promo.id}/edit`}
                          aria-label="Редактировать промокод"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-100 hover:text-gold-600"
                        >
                          <EditIcon className="h-4 w-4" />
                        </Link>
                        <DeleteButton
                          iconOnly
                          what={`промокод «${promo.code}»`}
                          consequence={
                            // Единственное удаление в админке, которое реально
                            // теряет данные: promo_code_redemptions удаляются
                            // каскадом вместе с кодом.
                            promo.timesUsed > 0
                              ? `Вместе с кодом сотрётся история его применений — ${promo.timesUsed} шт. Если нужна для отчётности, лучше просто отключить.`
                              : undefined
                          }
                          action={deletePromoCode.bind(null, promo.id)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
