import type { Metadata, Viewport } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canSeeCosts } from "@/lib/uchet/access";
import { getDefaultLocation } from "@/lib/uchet/queries";
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
  const staff = await requireStaffUser("/uchet");
  const location = await getDefaultLocation();

  return (
    <AppShell staffName={staff.fullName} isOwner={canSeeCosts(staff.role)} isTraining={location.isTraining}>
      {children}
    </AppShell>
  );
}
