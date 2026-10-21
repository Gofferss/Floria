import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canUseUchetWork, isOwnerRole } from "@/lib/auth/roles";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { listVitrine } from "@/lib/uchet/pos-queries";
import { VitrineView } from "@/components/uchet/vitrina/VitrineView";

export const metadata: Metadata = {
  title: "Витрина",
};

export const dynamic = "force-dynamic";

export default async function VitrinaPage() {
  const staff = await requireStaffUser("/uchet/vitrina", canUseUchetWork);
  const location = await getDefaultLocation();
  const withCosts = isOwnerRole(staff.role);
  const bouquets = await listVitrine(location.id, withCosts);

  return <VitrineView bouquets={bouquets} withCosts={withCosts} />;
}
