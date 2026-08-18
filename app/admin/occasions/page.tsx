import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { listOccasionsAdmin } from "@/lib/actions/occasions";
import { OccasionsManager } from "@/components/admin/occasions/OccasionsManager";

export const metadata: Metadata = {
  title: "Поводы — Админка Floria",
};

export const dynamic = "force-dynamic";

export default async function AdminOccasionsPage() {
  await requireStaffUser();
  const occasions = await listOccasionsAdmin();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Админка
        </span>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Поводы</h1>
        <p className="mt-2 font-body text-sm text-ink/60">
          Список поводов для фильтра каталога и формы товара — «День рождения», «8 марта» и т.д.
        </p>
      </div>

      <OccasionsManager occasions={occasions} />
    </div>
  );
}
