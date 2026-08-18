import { createSupabaseServerClient } from "@/lib/auth/server";
import { HeaderView } from "@/components/layout/HeaderView";

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Серверная обёртка над HeaderView: раньше бонусы в шапке были захардкожены
 * ("Бонусы: 480" всегда). Читаем customers.bonus_balance — уже
 * поддерживаемый в проекте кэш баланса из Posiflora (см.
 * lib/customer-sync.ts, bonus_balance_synced_at) — а не дёргаем Posiflora
 * напрямую на каждый рендер шапки (она есть на каждой странице сайта).
 * Актуальность кэша — задача checkout/аккаунта/вебхуков, не шапки.
 */
export async function Header() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let bonusBalance: number | null = null;

  if (user) {
    const { data: customer } = await supabase
      .from("customers")
      .select("bonus_balance")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    bonusBalance = toNumber(customer?.bonus_balance);
  }

  return <HeaderView isLoggedIn={!!user} bonusBalance={bonusBalance} />;
}
