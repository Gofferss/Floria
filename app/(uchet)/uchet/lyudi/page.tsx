import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { isOwnerRole } from "@/lib/auth/roles";
import { listAccounts, listEmployees } from "@/lib/uchet/people";
import { PeopleView } from "@/components/uchet/lyudi/PeopleView";

export const metadata: Metadata = {
  title: "Сотрудники",
};

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const me = await requireStaffUser("/uchet/lyudi", isOwnerRole);
  const [employees, accounts] = await Promise.all([listEmployees(), listAccounts()]);
  return <PeopleView employees={employees} accounts={accounts} meId={me.id} />;
}
