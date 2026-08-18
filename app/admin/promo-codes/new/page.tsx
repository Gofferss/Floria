import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { PromoCodeForm } from "@/components/admin/promo/PromoCodeForm";

export const metadata: Metadata = {
  title: "Новый промокод — Админка Floria",
};

export default async function NewPromoCodePage() {
  await requireStaffUser();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Промокоды
        </span>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Новый промокод</h1>
      </div>

      <PromoCodeForm />
    </div>
  );
}
