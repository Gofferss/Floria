import { requireStaffUser } from "@/lib/auth/server";
import { canUseSiteOrders } from "@/lib/auth/roles";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaffUser("/admin", canUseSiteOrders);

  return (
    <div className="min-h-screen bg-lavender-50/40">
      <AdminNav role={staff.role} />
      {children}
    </div>
  );
}
