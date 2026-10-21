import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canSeeCosts } from "@/lib/uchet/access";
import { listStock } from "@/lib/uchet/queries";
import { formatDateTime, formatMoney } from "@/lib/uchet/format";
import { SkladHeader } from "@/components/admin/sklad/SkladHeader";
import { StockTable } from "@/components/admin/sklad/StockTable";

export const metadata: Metadata = {
  title: "Склад — Админка Floria",
};

export const dynamic = "force-dynamic";

export default async function SkladPage() {
  const staff = await requireStaffUser();
  const withCosts = canSeeCosts(staff.role);
  const rows = await listStock(withCosts);

  const active = rows.filter((r) => r.isActive);
  const positive = active.filter((r) => (r.posifloraQty ?? 0) > 0);
  const negative = active.filter((r) => (r.posifloraQty ?? 0) < 0);
  const snapshotAt = rows.map((r) => r.snapshotAt).filter(Boolean).sort().pop() ?? null;
  const posifloraValue = withCosts
    ? positive.reduce((sum, r) => sum + (r.posifloraQty ?? 0) * (r.posifloraUnitCost ?? 0), 0)
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <SkladHeader
        active="stock"
        title="Остатки"
        subtitle="Номенклатура перенесена из Posiflora. Группы, цены, минимумы и срок свежести можно править в карточке позиции."
      />

      {/* Без этого объяснения две колонки остатка выглядят как ошибка. */}
      <div className="mb-6 rounded-3xl border border-amber-200 bg-amber-50 px-6 py-4">
        <p className="font-display text-sm font-semibold text-amber-900">Пока главная — Posiflora</p>
        <p className="mt-1 max-w-3xl font-body text-sm text-amber-900/80">
          Продажи идут через Posiflora, поэтому наш учёт о них не знает, и колонка «У нас» растёт только от
          документов, заведённых здесь. Колонка «Posiflora» — снимок
          {snapshotAt ? ` от ${formatDateTime(snapshotAt)}` : ""}. Наш журнал станет главным после месяца
          параллельной работы и сверки.
        </p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-lavender-100 bg-white px-5 py-4">
          <p className="font-mono text-2xl font-semibold tabular-nums text-ink">{active.length}</p>
          <p className="mt-0.5 font-body text-xs text-ink/55">действующих позиций</p>
        </div>
        <div className="rounded-2xl border border-lavender-100 bg-white px-5 py-4">
          <p className="font-mono text-2xl font-semibold tabular-nums text-ink">{positive.length}</p>
          <p className="mt-0.5 font-body text-xs text-ink/55">с остатком в Posiflora</p>
        </div>
        <div className={`rounded-2xl border px-5 py-4 ${negative.length ? "border-red-200 bg-red-50" : "border-lavender-100 bg-white"}`}>
          <p className={`font-mono text-2xl font-semibold tabular-nums ${negative.length ? "text-red-700" : "text-ink"}`}>
            {negative.length}
          </p>
          <p className="mt-0.5 font-body text-xs text-ink/55">в минусе в Posiflora — продано больше, чем пришло</p>
        </div>
        {withCosts && (
          <div className="rounded-2xl border border-lavender-100 bg-white px-5 py-4">
            <p className="font-mono text-2xl font-semibold tabular-nums text-ink">≈ {formatMoney(Math.round(posifloraValue ?? 0))}</p>
            <p className="mt-0.5 font-body text-xs text-ink/55">стоимость остатка в Posiflora, оценка</p>
          </div>
        )}
      </div>

      <StockTable rows={rows} withCosts={withCosts} />
    </div>
  );
}
