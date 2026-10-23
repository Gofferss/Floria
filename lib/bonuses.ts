import { getSupabaseAdmin } from "@/lib/supabase";
import { isVtbSandbox } from "@/lib/payments/vtb";

// ================================================================
// Бонусы на стороне сайта — после перехода на бонусы Учёта (миграция 033,
// pos_settings.bonuses_enabled). До перехода ничего здесь не действует:
// баланс ведёт Posiflora, сайт его только показывает.
//
// После перехода баланс — итог журнала customer_bonus_moves, двигает его
// только bonus_move в базе. Поэтому:
//   * синхронизация с Posiflora больше не пишет bonus_balance
//     (lib/customer-sync.ts спрашивает bonusesInUchet);
//   * оплата заказа сайта списывает потраченные бонусы и начисляет новые
//     (applySiteOrderBonuses из lib/payments/confirm.ts);
//   * отмена оплаченного заказа возвращает списанное и снимает
//     начисленное (reverseSiteOrderBonuses из updateOrderStatus).
// ================================================================

let cached: { at: number; on: boolean; percent: number } | null = null;

async function mode(): Promise<{ on: boolean; percent: number }> {
  if (cached && Date.now() - cached.at < 30_000) return cached;
  const { data, error } = await getSupabaseAdmin().from("pos_settings").select("bonuses_enabled, bonus_percent").eq("id", true).maybeSingle();
  if (error) throw new Error(`Настройки бонусов: ${error.message}`);
  cached = { at: Date.now(), on: !!data?.bonuses_enabled, percent: Number(data?.bonus_percent) || 0 };
  return cached;
}

/** Бонусы ведёт Учёт (а не Posiflora). Сбой чтения настроек — считаем «нет»: так сайт ведёт себя по-старому. */
export async function bonusesInUchet(): Promise<boolean> {
  try {
    return (await mode()).on;
  } catch (e) {
    console.error("[bonuses]", e instanceof Error ? e.message : e);
    return false;
  }
}

type Move = { customer: string; delta: number; kind: "earn" | "spend" | "reverse" | "return"; order: string; comment: string; clamp?: boolean };

async function move(m: Move): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc("bonus_move", {
    p_customer: m.customer,
    p_delta: m.delta,
    p_kind: m.kind,
    p_sale: null,
    p_site_order: m.order,
    p_staff: null,
    p_comment: m.comment,
    p_clamp: !!m.clamp,
  });
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

/**
 * Заказ сайта оплачен: списать бонусы, которыми платили, и начислить
 * процент от оплаченного деньгами. Тестовая оплата ВТБ (песочница) бонусы
 * не двигает — денег за ней нет. Возвращает, сколько списали меньше, чем
 * просили (клиент мог успеть потратить бонусы в другом заказе).
 */
export async function applySiteOrderBonuses(order: { id: string; number: string; customerId: string | null; bonusUsed: number; total: number }): Promise<{ spent: number; earned: number; short: number }> {
  const none = { spent: 0, earned: 0, short: 0 };
  if (!order.customerId || isVtbSandbox()) return none;
  const { on, percent } = await mode();
  if (!on) return none;
  const want = Math.max(0, Math.floor(order.bonusUsed));
  const spent = want ? -(await move({ customer: order.customerId, delta: -want, kind: "spend", order: order.id, comment: `Заказ сайта ${order.number}`, clamp: true })) : 0;
  const earn = Math.floor((Math.max(0, order.total) * percent) / 100);
  const earned = earn ? await move({ customer: order.customerId, delta: earn, kind: "earn", order: order.id, comment: `Заказ сайта ${order.number}` }) : 0;
  return { spent, earned, short: want - spent };
}

/**
 * Оплаченный заказ сайта отменён: вернуть списанные бонусы и снять
 * начисленные (сколько осталось — отмену бонусами не блокируем).
 * Повторная отмена ничего не задвоит: отменённое уже отмечено в журнале.
 */
export async function reverseSiteOrderBonuses(orderId: string, orderNumber: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("customer_bonus_moves").select("customer_id, delta, kind").eq("site_order_id", orderId);
  if (error) throw new Error(`Бонусы заказа: ${error.message}`);
  const moves = data ?? [];
  if (moves.some((m) => m.kind === "reverse" || m.kind === "return")) return;
  for (const m of moves) {
    const delta = Number(m.delta);
    if (m.kind === "earn" && delta > 0) await move({ customer: m.customer_id, delta: -delta, kind: "reverse", order: orderId, comment: `Отмена заказа сайта ${orderNumber}`, clamp: true });
    if (m.kind === "spend" && delta < 0) await move({ customer: m.customer_id, delta: -delta, kind: "return", order: orderId, comment: `Отмена заказа сайта ${orderNumber}` });
  }
}
