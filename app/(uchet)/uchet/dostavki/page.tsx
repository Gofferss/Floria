import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canDeliver, canUseUchetWork } from "@/lib/auth/roles";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { studioDate } from "@/lib/uchet/order-queries";
import { ensurePoints, listCouriers, loadDayStops, studioPoint, type PlanStop } from "@/lib/uchet/delivery-plan";
import { hasDadataKey } from "@/lib/geo/dadata";
import { DeliveryList } from "@/components/uchet/dostavki/DeliveryList";
import { DeliveryPlanner } from "@/components/uchet/dostavki/DeliveryPlanner";

export const metadata: Metadata = {
  title: "Доставки",
};

export const dynamic = "force-dynamic";

const byPlan = (a: PlanStop, b: PlanStop) =>
  (a.seq ?? 999) - (b.seq ?? 999) || (a.timeFrom ?? "99").localeCompare(b.timeFrom ?? "99");

/**
 * Доставки. В магазине (флорист, владелец) — план дня: разложить по
 * курьерам и построить маршруты. У курьера — свой список в порядке
 * маршрута, на сегодня и завтра.
 */
export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const staff = await requireStaffUser("/uchet/dostavki", canDeliver);
  const params = await searchParams;
  const location = await getDefaultLocation();

  if (canUseUchetWork(staff.role)) {
    const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : studioDate(0);
    const [stops, couriers, start] = await Promise.all([loadDayStops(day, location.id), listCouriers(), studioPoint()]);
    await ensurePoints(stops);
    return <DeliveryPlanner day={day} stops={stops} couriers={couriers} start={start} hasKey={hasDadataKey()} />;
  }

  // Курьер: если на день доставки уже разложены по курьерам — только свои;
  // если нет (обычный день, курьер один) — все.
  const today = studioDate(0);
  const tomorrow = studioDate(1);
  const [todayStops, tomorrowStops] = await Promise.all([loadDayStops(today, location.id), loadDayStops(tomorrow, location.id)]);
  await ensurePoints([...todayStops, ...tomorrowStops]);
  const mine = (list: PlanStop[]) => (list.some((s) => s.courierId) ? list.filter((s) => s.courierId === staff.id) : list).sort(byPlan);

  return (
    <DeliveryList
      days={[
        { title: "Сегодня", stops: mine(todayStops) },
        { title: "Завтра", stops: mine(tomorrowStops) },
      ]}
    />
  );
}
