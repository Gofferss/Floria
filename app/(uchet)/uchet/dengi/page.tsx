import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { isOwnerRole } from "@/lib/auth/roles";
import { loadMoney } from "@/lib/uchet/money";
import { resolvePayMonth } from "@/lib/uchet/payroll";
import { MoneyView } from "@/components/uchet/dengi/MoneyView";

export const metadata: Metadata = {
  title: "Деньги",
};

export const dynamic = "force-dynamic";

/** Деньги — только владельцам. */
export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireStaffUser("/uchet/dengi", isOwnerRole);
  const { m } = await searchParams;
  const money = await loadMoney(resolvePayMonth(m));
  return <MoneyView money={money} />;
}
