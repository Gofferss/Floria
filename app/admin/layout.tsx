import { requireStaffUser } from "@/lib/auth/server";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireStaffUser();

  return (
    <div className="min-h-screen bg-lavender-50/40">
      <AdminNav />
      {children}
    </div>
  );
}
