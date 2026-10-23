import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Чтение для экрана «Настройки»: справочники кассы целиком, вместе с
// выключенными — касса видит только включённые (pos-queries.ts).
// ================================================================

export type CashReasonKind = "purchase" | "salary" | "collection" | "refund" | "other";

export type PaymentMethodRow = { code: string; title: string; isCash: boolean; isActive: boolean; sort: number; used: boolean };
export type CashReasonRow = { id: string; direction: "in" | "out"; title: string; kind: CashReasonKind; isActive: boolean; sort: number };

export async function listAllPaymentMethods(): Promise<PaymentMethodRow[]> {
  const admin = getSupabaseAdmin();
  const [{ data, error }, { data: used, error: usedError }] = await Promise.all([
    admin.from("pos_payment_methods").select("code, title, is_cash, is_active, sort").neq("code", "posiflora").order("sort"),
    // Каким способом уже платили — у такого не меняют «наличные или нет»:
    // это пересчитало бы ожидаемые наличные в прошлых сменах.
    admin.from("pos_payments").select("method").limit(5000),
  ]);
  if (error) throw new Error(`Способы оплаты: ${error.message}`);
  if (usedError) throw new Error(`Оплаты: ${usedError.message}`);
  const usedSet = new Set((used ?? []).map((p) => p.method));
  return (data ?? []).map((m) => ({ code: m.code, title: m.title, isCash: m.is_cash, isActive: m.is_active, sort: m.sort, used: usedSet.has(m.code) }));
}

export async function listAllCashReasons(): Promise<CashReasonRow[]> {
  const { data, error } = await getSupabaseAdmin().from("pos_cash_reasons").select("id, direction, title, kind, is_active, sort").order("direction").order("sort");
  if (error) throw new Error(`Причины движения наличных: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, direction: r.direction, title: r.title, kind: r.kind as CashReasonKind, isActive: r.is_active, sort: r.sort }));
}
