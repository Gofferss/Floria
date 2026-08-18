import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/server";
import { getPosifloraClientBalance } from "@/lib/posiflora";
import { syncCustomerWithPosiflora } from "@/lib/customer-sync";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { BonusCard } from "@/components/account/BonusCard";
import { ProfileCompletionBanner } from "@/components/account/ProfileCompletionBanner";
import { OrderHistoryList, type AccountOrder } from "@/components/account/OrderHistoryList";
import { EditableName } from "@/components/account/EditableName";
import { BotanicalPattern } from "@/components/ui/BotanicalPattern";
import { PhoneIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Личный кабинет — Floria",
};

const memberSinceFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });

function getInitials(name: string | null): string {
  if (!name) return "F";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return initials.join("") || "F";
}

type AccountCustomer = {
  id: string;
  phone: string | null;
  full_name: string | null;
  posiflora_client_id: string | null;
};

/**
 * Разрешает актуальный баланс бонусов с самовосстановлением связи:
 *   - есть posiflora_client_id → обычный путь, просто спросить баланс;
 *   - есть phone, но нет posiflora_client_id → карточка клиента могла
 *     получить номер ДО того, как заработала реальная интеграция
 *     (именно этот случай и обнаружился) — ищем/создаём клиента в CRM
 *     через ту же syncCustomerWithPosiflora, что использует вебхук, и
 *     чиним связь на лету, не дожидаясь следующего сообщения боту;
 *   - нет ни того, ни другого → синхронизировать банально нечем.
 * Сбой на любом из путей — 0, без падения страницы.
 */
async function resolveAccountBonusBalance(customer: AccountCustomer | null): Promise<number> {
  if (!customer) return 0;

  if (customer.posiflora_client_id) {
    try {
      const { bonusBalance } = await getPosifloraClientBalance(customer.posiflora_client_id);
      return bonusBalance;
    } catch (error) {
      console.error("Не удалось получить баланс бонусов из Posiflora:", error);
      return 0;
    }
  }

  if (customer.phone) {
    try {
      const synced = await syncCustomerWithPosiflora(customer.id, customer.phone, customer.full_name);
      return synced.bonusBalance;
    } catch (error) {
      console.error("Не удалось восстановить связь с Posiflora по номеру телефона:", error);
      return 0;
    }
  }

  return 0;
}

export default async function AccountPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware уже должен был отправить на /login, если user нет — эта
  // проверка здесь как страховка (см. app/admin/page.tsx — тот же принцип).
  if (!user) {
    redirect("/login?redirect=/account");
  }

  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name, phone, posiflora_client_id, created_at")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // Заказы и баланс бонусов не зависят друг от друга — запускаем
  // параллельно, а не один за другим: живой запрос в Posiflora (и
  // возможное самовосстановление связи) и так добавляет странице
  // сетевую задержку, которой раньше не было.
  const [ordersResult, bonusBalance] = await Promise.all([
    customer
      ? supabase
          .from("orders")
          .select("id, order_number, status, total_amount, delivery_date, created_at")
          .eq("customer_id", customer.id)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null }),

    resolveAccountBonusBalance(customer),
  ]);

  const orders = (ordersResult.data ?? []) as AccountOrder[];

  const fullName = customer?.full_name ?? "";
  const phone = customer?.phone ?? null;
  const memberSince = customer?.created_at
    ? memberSinceFormatter.format(new Date(customer.created_at))
    : null;

  return (
    <>
      {/* Тёплая шапка кабинета — та же тональность, что на /login, чтобы
          вход и кабинет читались как одно путешествие, а не два разных сайта */}
      <header className="relative overflow-hidden bg-gradient-to-b from-lavender-100 to-lavender-50">
        <BotanicalPattern className="pointer-events-none absolute inset-0 h-full w-full text-lavender-500/40" />

        <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white font-display text-lg font-bold text-gold-600 shadow-sm sm:h-16 sm:w-16 sm:text-xl">
                {getInitials(fullName)}
              </span>
              <div>
                <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
                  Личный кабинет
                </span>
                <h1 className="mt-1 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
                  {fullName ? `Здравствуйте, ${fullName}` : "Здравствуйте!"}
                </h1>
                {memberSince && (
                  <p className="mt-1 font-body text-sm text-ink/50">С нами с {memberSince}</p>
                )}
              </div>
            </div>

            <LogoutButton className="hidden shrink-0 font-body text-sm text-ink/50 underline decoration-lavender-300 underline-offset-4 transition hover:text-ink sm:inline-block" />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        {!phone && (
          <div className="mb-8">
            <ProfileCompletionBanner initialPhone={phone} />
          </div>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px] lg:gap-12">
          {/* Основная колонка — заказы */}
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Мои заказы</h2>
            <div className="mt-4">
              <OrderHistoryList orders={orders} />
            </div>
          </div>

          {/* Боковая колонка — бонусы и профиль */}
          <div className="flex flex-col gap-6 lg:sticky lg:top-28 lg:self-start">
            <BonusCard balance={bonusBalance} />

            <div className="rounded-3xl border border-lavender-100 bg-white p-6">
              <span className="font-display text-sm font-semibold text-ink">Профиль</span>

              <div className="mt-4">
                <EditableName authUserId={user.id} initialName={fullName} />
              </div>

              <div className="mt-4 flex items-center gap-2.5 border-t border-lavender-100 pt-4">
                <PhoneIcon className="h-4 w-4 shrink-0 text-ink/30" />
                <span className="font-body text-sm text-ink/70">
                  {phone ?? "Пока не указан"}
                </span>
              </div>

            </div>

            <LogoutButton className="text-center font-body text-sm text-ink/50 underline decoration-lavender-300 underline-offset-4 transition hover:text-ink sm:hidden" />
          </div>
        </div>
      </div>
    </>
  );
}
