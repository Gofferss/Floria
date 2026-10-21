import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canUseUchetWork } from "@/lib/auth/roles";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { getLastClosedShift, getOpenShift, getShiftTotals, listCashReasons, listShiftCash } from "@/lib/uchet/pos-queries";
import { listEmployees } from "@/lib/uchet/people";
import { ShiftView } from "@/components/uchet/smena/ShiftView";

export const metadata: Metadata = {
  title: "Смена",
};

export const dynamic = "force-dynamic";

export default async function SmenaPage() {
  await requireStaffUser("/uchet/smena", canUseUchetWork);
  const location = await getDefaultLocation();
  const [shift, lastClosed, reasons, employees] = await Promise.all([
    getOpenShift(location.id),
    getLastClosedShift(location.id),
    listCashReasons(),
    listEmployees(),
  ]);
  const [cash, totals] = shift ? await Promise.all([listShiftCash(shift), getShiftTotals(shift.id)]) : [[], null];

  return (
    <ShiftView
      shift={shift}
      lastClosed={lastClosed}
      cash={cash}
      totals={totals}
      reasons={reasons}
      employees={employees.filter((e) => e.isActive).map((e) => ({ id: e.id, shortName: e.shortName }))}
    />
  );
}
