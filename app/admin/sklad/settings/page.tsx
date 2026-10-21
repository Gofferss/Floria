import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { listGroups, listReasons, listSuppliers } from "@/lib/uchet/queries";
import { SkladHeader } from "@/components/admin/sklad/SkladHeader";
import { GroupsEditor, ReasonsEditor, SuppliersEditor } from "@/components/admin/sklad/Dictionaries";

export const metadata: Metadata = {
  title: "Справочники склада — Админка Floria",
};

export const dynamic = "force-dynamic";

export default async function SkladSettingsPage() {
  await requireStaffUser();
  const [groups, suppliers, reasons] = await Promise.all([listGroups(), listSuppliers(), listReasons()]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <SkladHeader
        active="settings"
        title="Справочники"
        subtitle="Всё, что здесь, меняется без программиста. Удалять ничего не нужно — ненужное выключите, и оно пропадёт из списков, сохранившись в истории."
      />

      <p className="mb-6 font-body text-sm text-ink/60">
        Новая позиция склада —{" "}
        <Link href="/admin/sklad/items/new" className="text-ink underline decoration-lavender-300 underline-offset-4 hover:text-gold-700">
          здесь
        </Link>
        .
      </p>

      <div className="flex flex-col gap-6">
        <GroupsEditor groups={groups} />
        <ReasonsEditor reasons={reasons} />
        <SuppliersEditor suppliers={suppliers} />
      </div>
    </div>
  );
}
