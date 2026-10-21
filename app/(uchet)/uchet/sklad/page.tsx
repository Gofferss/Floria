import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canSeeCosts } from "@/lib/uchet/access";
import { getDefaultLocation, listGroups, listReasons, listStock } from "@/lib/uchet/queries";
import { formatDateTime } from "@/lib/uchet/format";
import { SkladHeader } from "@/components/uchet/sklad/SkladHeader";
import { StockView } from "@/components/uchet/sklad/StockView";
import { ui } from "@/components/uchet/ui";

export const metadata: Metadata = { title: "Склад" };

export const dynamic = "force-dynamic";

export default async function SkladPage() {
  const staff = await requireStaffUser("/uchet/sklad");
  const withCosts = canSeeCosts(staff.role);

  const [rows, groups, reasons, location] = await Promise.all([
    listStock(withCosts),
    listGroups(),
    listReasons(),
    getDefaultLocation(),
  ]);
  const snapshotAt = rows.map((r) => r.snapshotAt).filter(Boolean).sort().pop() ?? null;

  return (
    <div className={ui.page}>
      <SkladHeader active="stock" />

      {location.isTraining && (
        <div className="mb-5 flex flex-wrap items-start gap-x-6 gap-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm text-amber-900">
          <p className="font-semibold">Учёт ещё не запущен — режим тренировки</p>
          <p className="max-w-3xl text-amber-900/80">
            Главная сейчас — Posiflora: остатки взяты из неё
            {snapshotAt ? ` (${formatDateTime(snapshotAt)})` : ""}. Приходы, списания и пересчёты здесь попадают в
            отдельное место «Тренировка» и не смешаются с настоящим учётом — пробуйте спокойно.
          </p>
        </div>
      )}

      <StockView rows={rows} groups={groups} reasons={reasons} withCosts={withCosts} isTraining={location.isTraining} />
    </div>
  );
}
