import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canUseSiteOrders } from "@/lib/auth/roles";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { getOpenShift, listPaymentMethods } from "@/lib/uchet/pos-queries";
import { listWorkOrders } from "@/lib/uchet/order-queries";
import { OrdersBoard } from "@/components/uchet/zakazy/OrdersBoard";

export const metadata: Metadata = {
  title: "Заказы",
};

export const dynamic = "force-dynamic";

/**
 * Заказы с сайта и из магазина — в учёте, рядом с кассой и витриной.
 * Доступ — как к заказам сайта (canUseSiteOrders): у флориста он есть.
 */
export default async function ZakazyPage() {
  await requireStaffUser("/uchet/zakazy", canUseSiteOrders);
  const location = await getDefaultLocation();
  const [{ work, awaitingPayment, doneToday }, methods, shift] = await Promise.all([
    listWorkOrders(location.id),
    listPaymentMethods(),
    getOpenShift(location.id),
  ]);
  return <OrdersBoard work={work} awaitingPayment={awaitingPayment} doneToday={doneToday} methods={methods} shiftOpen={!!shift} />;
}
