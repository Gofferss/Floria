import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { canUseUchetWork } from "@/lib/auth/roles";
import { canSeeCosts } from "@/lib/uchet/access";
import { listGroups, listLocations, listReasons, listSuppliers } from "@/lib/uchet/queries";
import { SkladHeader } from "@/components/uchet/sklad/SkladHeader";
import { GroupsEditor, ReasonsEditor, SuppliersEditor } from "@/components/uchet/sklad/Dictionaries";
import { LaunchCard } from "@/components/uchet/sklad/LaunchCard";
import { ui } from "@/components/uchet/ui";

export const metadata: Metadata = {
  title: "Справочники склада",
};

export const dynamic = "force-dynamic";

export default async function SkladSettingsPage() {
  const staff = await requireStaffUser("/uchet/sklad/settings", canUseUchetWork);
  const isOwner = canSeeCosts(staff.role);
  const [groups, suppliers, reasons, locations] = await Promise.all([
    listGroups(),
    listSuppliers(),
    listReasons(),
    listLocations(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
      <SkladHeader
        active="settings"
        title="Справочники"
        subtitle="Всё здесь меняется без программиста. Удалять ничего не нужно: ненужное выключите — оно пропадёт из списков, а в истории останется."
      />

      <div className="flex flex-col gap-5">
        {isOwner && <LaunchCard locations={locations} />}

        <p className={ui.muted}>
          Новая позиция склада —{" "}
          <Link href="/uchet/sklad/items/new" className="font-medium text-zinc-900 underline underline-offset-4 hover:text-lavender-700">
            создать
          </Link>
          .
        </p>

        <GroupsEditor groups={groups} />
        <ReasonsEditor reasons={reasons} />
        <SuppliersEditor suppliers={suppliers} />
      </div>
    </div>
  );
}
