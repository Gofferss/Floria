import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { canUseUchetWork } from "@/lib/auth/roles";
import { listGroups, listUnits } from "@/lib/uchet/queries";
import { SkladHeader } from "@/components/uchet/sklad/SkladHeader";
import { ItemForm } from "@/components/uchet/sklad/ItemForm";

export const metadata: Metadata = {
  title: "Новая позиция",
};

export const dynamic = "force-dynamic";

export default async function NewSkladItemPage() {
  await requireStaffUser("/uchet/sklad", canUseUchetWork);
  const [groups, units] = await Promise.all([listGroups(), listUnits()]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 lg:px-8">
      <SkladHeader active="stock" title="Новая позиция" subtitle="Остаток появится после первого прихода." />
      <Link href="/uchet/sklad" className="font-body text-sm text-ink/55 underline decoration-lavender-300 underline-offset-4 hover:text-ink">
        ← Все остатки
      </Link>
      <div className="mt-6">
        <ItemForm groups={groups} units={units} />
      </div>
    </div>
  );
}
