import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaffUser } from "@/lib/auth/server";
import { canPostOpening, canSeeCosts } from "@/lib/uchet/access";
import { listPickerItems, listReasons, listSuppliers } from "@/lib/uchet/queries";
import { DOC_TYPES, DOC_TYPE_LABEL, type DocType } from "@/lib/uchet/format";
import { SkladHeader } from "@/components/admin/sklad/SkladHeader";
import { DocumentEditor } from "@/components/admin/sklad/DocumentEditor";

export const metadata: Metadata = {
  title: "Новый документ склада — Админка Floria",
};

export const dynamic = "force-dynamic";

export default async function NewSkladDocPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const staff = await requireStaffUser();

  const docType = DOC_TYPES.includes(type as DocType) ? (type as DocType) : null;
  if (!docType) redirect("/admin/sklad/docs/new?type=receipt");
  if (docType === "opening" && !canPostOpening(staff.role)) redirect("/admin/sklad/docs");

  const [items, suppliers, reasons] = await Promise.all([listPickerItems(), listSuppliers(), listReasons()]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <SkladHeader active="docs" title={`Новый документ: ${DOC_TYPE_LABEL[docType].toLowerCase()}`} />
      <Link href="/admin/sklad/docs" className="font-body text-sm text-ink/55 underline decoration-lavender-300 underline-offset-4 hover:text-ink">
        ← Все документы
      </Link>
      <div className="mt-6">
        <DocumentEditor
          docType={docType}
          items={items}
          suppliers={suppliers}
          reasons={reasons}
          withCosts={canSeeCosts(staff.role)}
        />
      </div>
    </div>
  );
}
