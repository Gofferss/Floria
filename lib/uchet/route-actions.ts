"use server";

import { revalidatePath } from "next/cache";
import { requireStaffAction } from "@/lib/auth/server";
import { canUseUchetWork } from "@/lib/auth/roles";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { ensurePoints, listCouriers, loadDayStops, saveStopPlan, studioPoint, type PlanStop } from "@/lib/uchet/delivery-plan";
import { orderRoute, splitByCouriers } from "@/lib/uchet/route";

// ================================================================
// Планирование доставок: разложить по курьерам и построить порядок.
// Делает тот, кто в магазине (флорист, владелец), а не сам курьер.
// Уже доставленные и уехавшие не трогаем — план касается того, что ещё
// не выехало.
// ================================================================

type Result<T = undefined> = { success: true; data: T } | { success: false; error: string };

const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const movable = (s: PlanStop) => s.status !== "completed" && s.status !== "delivering";

async function dayStops(day: string) {
  const location = await getDefaultLocation();
  const stops = await loadDayStops(day, location.id);
  await ensurePoints(stops);
  return stops;
}

/** Порядок у одного курьера — заново, с учётом окон и расстояний. */
async function reorder(stops: PlanStop[], courierId: string | null) {
  const start = await studioPoint();
  const mine = stops.filter((s) => s.courierId === courierId && movable(s));
  // Уже уехавшие остаются в начале: их номера не сдвигаем.
  const done = stops.filter((s) => s.courierId === courierId && !movable(s)).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const ordered = orderRoute(
    mine.map((s) => ({ key: s.key, point: s.point, from: s.timeFrom, stop: s })),
    start
  );
  let seq = done.length;
  for (const r of ordered) {
    seq++;
    await saveStopPlan(r.stop, courierId, courierId ? seq : null);
  }
}

export async function planDay(day: string, courierIds: string[]): Promise<Result<{ planned: number; withoutPoint: number }>> {
  await requireStaffAction(canUseUchetWork);
  if (!isDay(day)) return { success: false, error: "Неверный день" };
  const couriers = await listCouriers();
  const chosen = courierIds.filter((id) => couriers.some((c) => c.id === id));
  if (chosen.length === 0) return { success: false, error: "Выберите хотя бы одного курьера" };

  const stops = await dayStops(day);
  const free = stops.filter(movable);
  if (free.length === 0) return { success: false, error: "На этот день нечего планировать" };

  const start = await studioPoint();
  const split = splitByCouriers(
    free.map((s) => ({ key: s.key, point: s.point, from: s.timeFrom })),
    chosen,
    start
  );
  for (const s of free) s.courierId = split.get(s.key) ?? null;
  for (const c of chosen) await reorder(stops, c);

  revalidatePath("/uchet", "layout");
  return { success: true, data: { planned: free.length, withoutPoint: free.filter((s) => !s.point).length } };
}

export async function setStopCourier(day: string, key: string, courierId: string | null): Promise<Result> {
  await requireStaffAction(canUseUchetWork);
  if (!isDay(day)) return { success: false, error: "Неверный день" };
  const stops = await dayStops(day);
  const stop = stops.find((s) => s.key === key);
  if (!stop) return { success: false, error: "Доставка не найдена" };
  if (!movable(stop)) return { success: false, error: "Курьер уже везёт этот заказ" };

  const before = stop.courierId;
  stop.courierId = courierId;
  await saveStopPlan(stop, courierId, null);
  // Перестраиваем обоих: у кого забрали и кому отдали.
  if (before && before !== courierId) await reorder(stops, before);
  if (courierId) await reorder(stops, courierId);

  revalidatePath("/uchet", "layout");
  return { success: true, data: undefined };
}

/** Вручную: поднять или опустить остановку на одну позицию. */
export async function moveStop(day: string, key: string, direction: -1 | 1): Promise<Result> {
  await requireStaffAction(canUseUchetWork);
  if (!isDay(day)) return { success: false, error: "Неверный день" };
  const location = await getDefaultLocation();
  const stops = await loadDayStops(day, location.id);
  const stop = stops.find((s) => s.key === key);
  if (!stop?.courierId || stop.seq === null) return { success: false, error: "Сначала разложите доставки по курьерам" };

  const line = stops.filter((s) => s.courierId === stop.courierId && s.seq !== null).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const at = line.findIndex((s) => s.key === key);
  const other = line[at + direction];
  if (!other) return { success: true, data: undefined };
  if (!movable(stop) || !movable(other)) return { success: false, error: "Уже уехавшие остановки не переставляются" };

  await saveStopPlan(stop, stop.courierId, other.seq);
  await saveStopPlan(other, other.courierId, stop.seq);
  revalidatePath("/uchet", "layout");
  return { success: true, data: undefined };
}
