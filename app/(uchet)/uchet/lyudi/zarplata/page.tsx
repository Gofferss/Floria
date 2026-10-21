import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { isOwnerRole } from "@/lib/auth/roles";
import { loadPayroll, resolvePayMonth } from "@/lib/uchet/payroll";
import { PayrollView } from "@/components/uchet/lyudi/PayrollView";

export const metadata: Metadata = {
  title: "Зарплата",
};

export const dynamic = "force-dynamic";

/** Зарплата — только владельцам: в ней чужие деньги. */
export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireStaffUser("/uchet/lyudi/zarplata", isOwnerRole);
  const { m } = await searchParams;
  const payroll = await loadPayroll(resolvePayMonth(m));
  return <PayrollView payroll={payroll} />;
}
