import type { Metadata, Viewport } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canEnterUchet, canUseUchetWork, isOwnerRole } from "@/lib/auth/roles";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { getOpenShift } from "@/lib/uchet/pos-queries";
import { getCurrentEmployee, needsEmployee } from "@/lib/uchet/employee";
import { listPickableEmployees } from "@/lib/uchet/people";
import { AppShell } from "@/components/uchet/AppShell";

// Учёт — рабочий инструмент, поисковикам в нём делать нечего.
export const metadata: Metadata = {
  title: { default: "Флория Учёт", template: "%s · Флория Учёт" },
  robots: { index: false, follow: false, nocache: true },
  manifest: "/uchet.webmanifest",
  // С экрана «Домой» на iPad открывается во весь экран, как приложение,
  // без адресной строки Safari.
  appleWebApp: { capable: true, title: "Флория Учёт", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#180F22",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function UchetLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaffUser("/uchet", canEnterUchet);
  const location = await getDefaultLocation();
  const works = canUseUchetWork(staff.role);

  const [employee, pickable, shift] = await Promise.all([
    getCurrentEmployee(staff),
    works ? listPickableEmployees() : Promise.resolve([]),
    works ? getOpenShift(location.id) : Promise.resolve(null),
  ]);
  const mustPick = works && (await needsEmployee(staff, employee));

  return (
    <AppShell
      staffName={staff.fullName}
      isOwner={isOwnerRole(staff.role)}
      isCourier={staff.role === "courier"}
      isTraining={location.isTraining}
      employee={employee ? { id: employee.id, shortName: employee.shortName } : null}
      needsEmployee={mustPick}
      pickable={isOwnerRole(staff.role) ? [] : pickable}
      shift={shift ? { openedAt: shift.openedAt, expectedCash: shift.expectedCash } : null}
    >
      {children}
    </AppShell>
  );
}
