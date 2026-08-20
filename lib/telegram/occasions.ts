// ================================================================
// Подсказка "похоже на ежегодный повод" — по истории ЗАКАЗОВ клиента
// (orders.delivery_date), а не по ручному вводу даты в боте. Если один
// и тот же день±3 повторяется в РАЗНЫХ годах — предлагаем завести на
// него напоминание.
//
// Источник дат — наш собственный orders (не Posiflora): именно там
// лежит delivery_date, привязанная к реальному поводу, а не к дню
// покупки. Пока на сайте не накопится хотя бы 2 заказа одного клиента
// в разные годы рядом с одной датой, кандидатов не будет вообще — это
// ожидаемо для молодого магазина, а не баг.
// ================================================================

import { getSupabaseAdmin } from "@/lib/supabase";

const DAY_TOLERANCE = 3;

export type OccasionCandidate = { day: number; month: number; years: number[] };

function dayOfYear(month: number, day: number): number {
  // "Виртуальный" номер дня в году без учёта високосности — нужен только
  // для группировки БЛИЗКИХ дат, не для реальных календарных вычислений.
  const cumDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cumDays[month - 1] + day;
}

export async function findRecurringOccasionCandidates(phone: string): Promise<OccasionCandidate[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select("delivery_date")
    .eq("customer_phone", phone);

  if (error) console.error("[findRecurringOccasionCandidates]", error.message);
  if (error || !data || data.length < 2) return [];

  const points = data
    .map((row) => new Date(row.delivery_date as string))
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }));

  const clusters: { month: number; day: number; years: Set<number> }[] = [];

  for (const point of points) {
    const doy = dayOfYear(point.month, point.day);
    const cluster = clusters.find((c) => Math.abs(dayOfYear(c.month, c.day) - doy) <= DAY_TOLERANCE);
    if (cluster) {
      cluster.years.add(point.year);
    } else {
      clusters.push({ month: point.month, day: point.day, years: new Set([point.year]) });
    }
  }

  return clusters
    .filter((c) => c.years.size >= 2)
    .map((c) => ({ day: c.day, month: c.month, years: [...c.years].sort((a, b) => a - b) }));
}

export async function isOccasionDismissed(chatId: number, month: number, day: number): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from("bot_occasion_dismissals")
    .select("chat_id")
    .eq("chat_id", chatId)
    .eq("event_month", month)
    .eq("event_day", day)
    .maybeSingle();
  return !!data;
}

export async function dismissOccasion(chatId: number, month: number, day: number): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("bot_occasion_dismissals")
    .upsert({ chat_id: chatId, event_month: month, event_day: day }, { onConflict: "chat_id,event_month,event_day" });
  if (error) console.error("[dismissOccasion]", error.message);
}

/** Подтверждённый кодом из СМС телефон — источник для подсказки поводов и (в будущем) уведомлений о статусе заказа. */
export async function linkBotUserPhone(chatId: number, phone: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("bot_users").update({ phone }).eq("chat_id", chatId);
  if (error) console.error("[linkBotUserPhone]", error.message);
}
