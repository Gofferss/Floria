import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { isOwnerRole } from "@/lib/auth/roles";
import { listCustomers, listPosifloraOnlyCustomers, type PosifloraCustomer } from "@/lib/uchet/customers";
import { getPosSettings } from "@/lib/uchet/pos-queries";
import { CustomersView } from "@/components/uchet/klienty/CustomersView";

export const metadata: Metadata = {
  title: "Клиенты",
};

export const dynamic = "force-dynamic";

type PosifloraCheck = { list: PosifloraCustomer[]; error: string | null };

/** Клиенты — только владельцам: это личные данные покупателей. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireStaffUser("/uchet/klienty", isOwnerRole);
  const query = ((await searchParams).q ?? "").slice(0, 60);
  const [customers, settings, posiflora] = await Promise.all([
    listCustomers(query),
    getPosSettings(),
    // Сверку с Posiflora показываем только на общем списке, не при поиске.
    query
      ? Promise.resolve<PosifloraCheck>({ list: [], error: null })
      : listPosifloraOnlyCustomers().then(
          (list): PosifloraCheck => ({ list, error: null }),
          (e): PosifloraCheck => ({ list: [], error: e instanceof Error ? e.message : String(e) })
        ),
  ]);
  return <CustomersView customers={customers} query={query} posiflora={posiflora.list} posifloraError={posiflora.error} bonusesEnabled={settings.bonusesEnabled} />;
}
