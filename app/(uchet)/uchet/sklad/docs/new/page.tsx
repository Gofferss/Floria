import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaffUser } from "@/lib/auth/server";
import { canPostOpening, canSeeCosts } from "@/lib/uchet/access";
import { listPickerItems, listReasons, listSuppliers } from "@/lib/uchet/queries";
import { DOC_TYPES, DOC_TYPE_LABEL, type DocType } from "@/lib/uchet/format";
import { SkladHeader } from "@/components/uchet/sklad/SkladHeader";
import { DocumentEditor } from "@/components/uchet/sklad/DocumentEditor";

export const metadata: Metadata = {
  title: "Новый документ",
};

export const dynamic = "force-dynamic";

export default async function NewSkladDocPage({ searchParams }: { searchParams: Promise<{ type?: string; items?: string }> }) {
  const { type, items: itemsParam } = await searchParams;
  // Позиции, отмеченные в списке склада («Пересчитать выбранные»). Берём
  // только то, что похоже на идентификатор: адрес мог прийти откуда угодно.
  const prefill = (itemsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    .slice(0, 150);
  const staff = await requireStaffUser("/uchet/sklad");

  const docType = DOC_TYPES.includes(type as DocType) ? (type as DocType) : null;
  if (!docType) redirect("/uchet/sklad/docs/new?type=receipt");
  if (docType === "opening" && !canPostOpening(staff.role)) redirect("/uchet/sklad/docs");

  const [items, suppliers, reasons] = await Promise.all([listPickerItems(), listSuppliers(), listReasons()]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
      <SkladHeader active="docs" title={`Новый документ: ${DOC_TYPE_LABEL[docType].toLowerCase()}`} />
      <Link href="/uchet/sklad/docs" className="font-body text-sm text-ink/55 underline decoration-lavender-300 underline-offset-4 hover:text-ink">
        ← Все документы
      </Link>
      <div className="mt-6">
        <DocumentEditor
          docType={docType}
          prefill={prefill}
          items={items}
          suppliers={suppliers}
          reasons={reasons}
          withCosts={canSeeCosts(staff.role)}
        />
      </div>
    </div>
  );
}
