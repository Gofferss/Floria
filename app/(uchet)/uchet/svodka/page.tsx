import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { isOwnerRole } from "@/lib/auth/roles";
import { loadSummary, resolvePeriod } from "@/lib/uchet/summary";
import { SummaryView } from "@/components/uchet/svodka/SummaryView";

export const metadata: Metadata = {
  title: "Сводка",
};

export const dynamic = "force-dynamic";

/** Сводка — только владельцам: в ней выручка и прибыль. */
export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ p?: string; m?: string }> }) {
  await requireStaffUser("/uchet/svodka", isOwnerRole);
  const period = resolvePeriod(await searchParams);
  const summary = await loadSummary(period);
  return <SummaryView summary={summary} />;
}
