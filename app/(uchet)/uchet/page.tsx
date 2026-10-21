import { redirect } from "next/navigation";
import { requireStaffUser } from "@/lib/auth/server";
import { canEnterUchet, canUseUchetWork } from "@/lib/auth/roles";

/** Первый экран — по роли: курьеру его доставки, остальным — склад (потом касса). */
export default async function UchetHome() {
  const staff = await requireStaffUser("/uchet", canEnterUchet);
  redirect(canUseUchetWork(staff.role) ? "/uchet/sklad" : "/uchet/dostavki");
}
