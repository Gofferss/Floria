"use server";

import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

const EVENT_TYPES = ["product_view", "add_to_cart", "button_click", "story_open"] as const;
type EventType = (typeof EVENT_TYPES)[number];

export type DailyBreakdown = { date: string } & Record<EventType, number>;
export type RankedItem = { label: string; count: number };
export type ProductStat = { label: string; views: number; addToCart: number };

export type AnalyticsSummary = {
  totals: Record<EventType, number>;
  daily: DailyBreakdown[];
  topProductViews: RankedItem[];
  topButtonClicks: RankedItem[];
  productStats: ProductStat[];
};

function emptyDaily(date: string): DailyBreakdown {
  return { date, product_view: 0, add_to_cart: 0, button_click: 0, story_open: 0 };
}

function topBy(events: { event_type: string; target: string }[], type: EventType, limit: number): RankedItem[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.event_type === type) counts.set(e.target, (counts.get(e.target) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Агрегируем прямо в JS поверх сырых событий за 30 дней — для объёма
 * небольшого цветочного магазина (сотни-тысячи событий в месяц) это
 * быстрее сделать, чем городить SQL-агрегацию ради преждевременной
 * оптимизации. Если объём вырастет на порядки — тогда и перепишем на
 * agregation view/materialized view.
 */
export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  await requireStaff();

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await getSupabaseAdmin()
    .from("analytics_events")
    .select("event_type, target, created_at")
    .gte("created_at", since30);

  if (error) {
    console.error("[getAnalyticsSummary]", error.message);
  }
  const events = data ?? [];

  const totals: Record<EventType, number> = {
    product_view: 0,
    add_to_cart: 0,
    button_click: 0,
    story_open: 0,
  };
  for (const e of events) {
    if ((EVENT_TYPES as readonly string[]).includes(e.event_type)) {
      totals[e.event_type as EventType]++;
    }
  }

  const dayBuckets = new Map<string, DailyBreakdown>();
  for (let i = 13; i >= 0; i--) {
    const key = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    dayBuckets.set(key, emptyDaily(key));
  }
  for (const e of events) {
    const key = String(e.created_at).slice(0, 10);
    const bucket = dayBuckets.get(key);
    if (bucket && (EVENT_TYPES as readonly string[]).includes(e.event_type)) {
      bucket[e.event_type as EventType]++;
    }
  }

  const viewCounts = new Map<string, number>();
  const cartCounts = new Map<string, number>();
  for (const e of events) {
    if (e.event_type === "product_view") viewCounts.set(e.target, (viewCounts.get(e.target) ?? 0) + 1);
    if (e.event_type === "add_to_cart") cartCounts.set(e.target, (cartCounts.get(e.target) ?? 0) + 1);
  }
  const productNames = new Set([...viewCounts.keys(), ...cartCounts.keys()]);
  const productStats: ProductStat[] = Array.from(productNames)
    .map((label) => ({ label, views: viewCounts.get(label) ?? 0, addToCart: cartCounts.get(label) ?? 0 }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  return {
    totals,
    daily: Array.from(dayBuckets.values()),
    topProductViews: topBy(events, "product_view", 8),
    topButtonClicks: topBy(events, "button_click", 10),
    productStats,
  };
}
