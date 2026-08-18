import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { BroadcastForm } from "@/components/admin/BroadcastForm";

export const metadata: Metadata = {
  title: "Рассылка в Telegram — Админка Floria",
};

export default async function BroadcastPage() {
  await requireStaffUser();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Админка
        </span>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">
          Рассылка в Telegram
        </h1>
        <p className="mt-2 font-body text-sm text-ink/60">
          Например, анонс предзаказов к 8 марта или 14 февраля.
        </p>
      </div>

      <BroadcastForm />
    </div>
  );
}
