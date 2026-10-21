import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canDeliver } from "@/lib/auth/roles";
import { listDeliveries, studioDate } from "@/lib/uchet/order-queries";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { DeliveryList } from "@/components/uchet/dostavki/DeliveryList";

export const metadata: Metadata = {
  title: "Доставки",
};

export const dynamic = "force-dynamic";

/** Доставки на сегодня и завтра — для курьера с телефона. */
export default async function DeliveriesPage() {
  await requireStaffUser("/uchet/dostavki", canDeliver);
  const today = studioDate(0);
  const tomorrow = studioDate(1);
  const location = await getDefaultLocation();
  const orders = await listDeliveries([today, tomorrow], location.id);

  return (
    <DeliveryList
      days={[
        { title: "Сегодня", orders: orders.filter((o) => o.date === today) },
        { title: "Завтра", orders: orders.filter((o) => o.date === tomorrow) },
      ]}
    />
  );
}
