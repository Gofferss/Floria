import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffUser } from "@/lib/auth/server";
import { canSeeCosts } from "@/lib/uchet/access";
import { getDocument, listPickerItems, listReasons, listSuppliers } from "@/lib/uchet/queries";
import { DOC_TYPE_LABEL, PAYMENT_LABEL, STATUS_LABEL, formatDateTime, formatMoney, formatQty } from "@/lib/uchet/format";
import { SkladHeader } from "@/components/admin/sklad/SkladHeader";
import { DocumentEditor } from "@/components/admin/sklad/DocumentEditor";
import { ReverseButton } from "@/components/admin/sklad/ReverseButton";

export const metadata: Metadata = {
  title: "Документ склада — Админка Floria",
};

export const dynamic = "force-dynamic";

export default async function SkladDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaffUser();
  const withCosts = canSeeCosts(staff.role);

  const doc = await getDocument(id, withCosts);
  if (!doc) notFound();

  const back = (
    <Link href="/admin/sklad/docs" className="font-body text-sm text-ink/55 underline decoration-lavender-300 underline-offset-4 hover:text-ink">
      ← Все документы
    </Link>
  );

  // Черновик редактируется той же формой, что и новый документ.
  if (doc.status === "draft") {
    const [items, suppliers, reasons] = await Promise.all([listPickerItems(), listSuppliers(), listReasons()]);
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <SkladHeader active="docs" title={`${DOC_TYPE_LABEL[doc.docType]} ${doc.docNo} · черновик`} />
        {back}
        <div className="mt-6">
          <DocumentEditor
            docType={doc.docType}
            initial={{
              id: doc.id,
              docNo: doc.docNo,
              date: doc.date,
              supplierId: doc.supplierId,
              reasonId: doc.reasonId,
              paymentMethod: doc.paymentMethod,
              comment: doc.comment,
              lines: doc.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitCost })),
            }}
            items={items}
            suppliers={suppliers}
            reasons={reasons}
            withCosts={withCosts}
          />
        </div>
      </div>
    );
  }

  const showMoney = doc.lines.some((l) => l.amount !== null);
  const isInventory = doc.docType === "inventory";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <SkladHeader active="docs" title={`${DOC_TYPE_LABEL[doc.docType]} ${doc.docNo}`} />
      {back}

      <div className="mt-6 rounded-3xl border border-lavender-100 bg-white p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 font-display text-xs font-semibold ${
              doc.status === "posted" ? "bg-green-50 text-green-800" : "bg-lavender-100 text-ink/60"
            }`}
          >
            {STATUS_LABEL[doc.status]}
          </span>
          {doc.reversalOf && (
            <span className="font-body text-sm text-ink/60">
              сторно документа{" "}
              <Link href={`/admin/sklad/docs/${doc.reversalOf.id}`} className="font-mono text-ink underline decoration-lavender-300 underline-offset-4">
                {doc.reversalOf.docNo}
              </Link>
            </span>
          )}
          {doc.reversedBy && (
            <span className="font-body text-sm text-ink/60">
              сторнирован документом{" "}
              <Link href={`/admin/sklad/docs/${doc.reversedBy.id}`} className="font-mono text-ink underline decoration-lavender-300 underline-offset-4">
                {doc.reversedBy.docNo}
              </Link>
            </span>
          )}
        </div>

        <dl className="mt-5 grid gap-4 font-body text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-ink/45">Дата</dt>
            <dd className="text-ink">{formatDateTime(doc.date)}</dd>
          </div>
          {doc.supplierTitle && (
            <div>
              <dt className="text-xs text-ink/45">Поставщик</dt>
              <dd className="text-ink">{doc.supplierTitle}</dd>
            </div>
          )}
          {doc.paymentMethod && (
            <div>
              <dt className="text-xs text-ink/45">Оплата</dt>
              <dd className="text-ink">{PAYMENT_LABEL[doc.paymentMethod]}</dd>
            </div>
          )}
          {doc.reasonTitle && (
            <div>
              <dt className="text-xs text-ink/45">Причина</dt>
              <dd className="text-ink">{doc.reasonTitle}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-ink/45">Провёл</dt>
            <dd className="text-ink">
              {doc.postedBy ?? "—"}
              {doc.postedAt && <span className="text-ink/45"> · {formatDateTime(doc.postedAt)}</span>}
            </dd>
          </div>
          {doc.comment && (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-ink/45">Комментарий</dt>
              <dd className="text-ink">{doc.comment}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="mt-6 overflow-hidden rounded-3xl border border-lavender-100 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-lavender-100 bg-lavender-50/60">
                <th className="px-5 py-3 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Позиция</th>
                {isInventory && (
                  <>
                    <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">По учёту</th>
                    <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Насчитали</th>
                  </>
                )}
                <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Изменение</th>
                {showMoney && (
                  <>
                    <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Цена</th>
                    <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Сумма</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={`${l.itemId}-${i}`} className="border-b border-lavender-50 last:border-0">
                  <td className="px-5 py-3">
                    <Link href={`/admin/sklad/items/${l.itemId}`} className="font-body text-sm text-ink hover:text-gold-700">
                      {l.itemTitle}
                    </Link>
                  </td>
                  {isInventory && (
                    <>
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink/60">{formatQty(l.stockBefore)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink">{formatQty(l.qty)}</td>
                    </>
                  )}
                  <td
                    className={`px-4 py-3 text-right font-mono text-sm tabular-nums ${
                      (l.qtyDelta ?? 0) < 0 ? "text-red-700" : "text-green-700"
                    }`}
                  >
                    {(l.qtyDelta ?? 0) > 0 ? "+" : ""}
                    {formatQty(l.qtyDelta)} {l.unit}
                  </td>
                  {showMoney && (
                    <>
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink/60">{formatMoney(l.unitCost)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink">{formatMoney(l.amount)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {doc.totalCost !== null && (
          <p className="border-t border-lavender-100 px-5 py-4 text-right font-display text-base font-semibold text-ink">
            Итого: <span className="font-mono tabular-nums">{formatMoney(doc.totalCost)}</span>
          </p>
        )}
      </div>

      {doc.status === "posted" && !doc.reversalOf && (
        <div className="mt-6">
          <ReverseButton id={doc.id} docNo={doc.docNo} />
        </div>
      )}
    </div>
  );
}
