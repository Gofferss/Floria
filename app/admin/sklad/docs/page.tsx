import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { canSeeCosts } from "@/lib/uchet/access";
import { listDocuments } from "@/lib/uchet/queries";
import {
  DOC_TYPES,
  DOC_TYPE_LABEL,
  STATUS_LABEL,
  formatDateTime,
  formatMoney,
  type DocStatus,
  type DocType,
} from "@/lib/uchet/format";
import { SkladHeader } from "@/components/admin/sklad/SkladHeader";

export const metadata: Metadata = {
  title: "Документы склада — Админка Floria",
};

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<DocStatus, string> = {
  draft: "bg-amber-50 text-amber-800",
  posted: "bg-green-50 text-green-800",
  reversed: "bg-lavender-100 text-ink/60",
};

export default async function SkladDocsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string }>;
}) {
  const params = await searchParams;
  const staff = await requireStaffUser();
  const withCosts = canSeeCosts(staff.role);

  const type = DOC_TYPES.includes(params.type as DocType) ? (params.type as DocType) : undefined;
  const status = ["draft", "posted", "reversed"].includes(params.status ?? "") ? (params.status as DocStatus) : undefined;
  const docs = await listDocuments({ type, status }, withCosts);

  const filterLink = (next: { type?: string; status?: string }) => {
    const q = new URLSearchParams();
    const t = "type" in next ? next.type : type;
    const s = "status" in next ? next.status : status;
    if (t) q.set("type", t);
    if (s) q.set("status", s);
    const qs = q.toString();
    return `/admin/sklad/docs${qs ? `?${qs}` : ""}`;
  };

  const chip = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 font-display text-xs font-semibold transition ${
      active ? "bg-ink text-white" : "bg-lavender-50 text-ink/70 hover:bg-lavender-100"
    }`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <SkladHeader active="docs" title="Документы" subtitle="Каждое изменение остатка — здесь. Проведённое не правится, ошибку исправляет сторно." />

      <div className="flex flex-wrap gap-2">
        <Link href={filterLink({ type: undefined })} className={chip(!type)}>
          Все типы
        </Link>
        {DOC_TYPES.map((t) => (
          <Link key={t} href={filterLink({ type: t })} className={chip(type === t)}>
            {DOC_TYPE_LABEL[t]}
          </Link>
        ))}
        <span className="mx-2 w-px self-stretch bg-lavender-100" aria-hidden="true" />
        <Link href={filterLink({ status: undefined })} className={chip(!status)}>
          Любой статус
        </Link>
        {(["draft", "posted", "reversed"] as DocStatus[]).map((s) => (
          <Link key={s} href={filterLink({ status: s })} className={chip(status === s)}>
            {STATUS_LABEL[s]}
          </Link>
        ))}
      </div>

      {docs.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-lavender-200 px-6 py-16 text-center">
          <p className="font-display text-lg font-semibold text-ink">Документов пока нет</p>
          <p className="mt-2 font-body text-sm text-ink/55">
            Первый приход — кнопка «Приход» справа вверху.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-3xl border border-lavender-100 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-lavender-100 bg-lavender-50/60">
                  <th className="px-5 py-3 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Документ</th>
                  <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Дата</th>
                  <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Подробности</th>
                  <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Позиций</th>
                  {withCosts && (
                    <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Сумма</th>
                  )}
                  <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Статус</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-b border-lavender-50 last:border-0 hover:bg-lavender-50/40">
                    <td className="px-5 py-3">
                      <Link href={`/admin/sklad/docs/${d.id}`} className="font-mono text-sm font-medium text-ink hover:text-gold-700">
                        {d.docNo}
                      </Link>
                      <span className="ml-2 font-body text-xs text-ink/50">
                        {DOC_TYPE_LABEL[d.docType]}
                        {d.isReversal ? " · сторно" : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-body text-sm text-ink/70">{formatDateTime(d.date)}</td>
                    <td className="px-4 py-3 font-body text-sm text-ink/70">
                      {[d.supplierTitle, d.reasonTitle, d.comment].filter(Boolean).join(" · ") || "—"}
                      {d.createdBy && <span className="block text-xs text-ink/40">{d.createdBy}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink/70">{d.linesCount}</td>
                    {withCosts && (
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink/70">
                        {d.status === "draft" ? "—" : formatMoney(d.totalCost)}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 font-display text-xs font-semibold ${STATUS_STYLE[d.status]}`}>
                        {STATUS_LABEL[d.status]}
                      </span>
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
