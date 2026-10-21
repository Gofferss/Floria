import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { isOwnerRole } from "@/lib/auth/roles";
import { getPosSettings } from "@/lib/uchet/pos-queries";
import { listAllCashReasons, listAllPaymentMethods } from "@/lib/uchet/settings-queries";
import { SettingsView } from "@/components/uchet/nastroiki/SettingsView";

export const metadata: Metadata = {
  title: "Настройки",
};

export const dynamic = "force-dynamic";

/** Правила кассы и её справочники — только владельцам. */
export default async function SettingsPage() {
  await requireStaffUser("/uchet/nastroiki", isOwnerRole);
  const [settings, methods, reasons] = await Promise.all([getPosSettings(), listAllPaymentMethods(), listAllCashReasons()]);
  return <SettingsView settings={settings} methods={methods} reasons={reasons} />;
}
