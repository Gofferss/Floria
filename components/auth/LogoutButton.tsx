"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/auth/client";
import { forgetUchetPages } from "@/components/uchet/useOfflineSupport";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();

  async function handleLogout() {
    // Копии экранов учёта для работы без связи хранят данные — после выхода им не место на айпаде.
    await forgetUchetPages();
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className={className || "font-display text-sm font-semibold text-red-600 transition hover:text-red-700"}
    >
      Выйти из аккаунта
    </button>
  );
}