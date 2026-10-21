import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canUseSiteOrders } from "@/lib/auth/roles";
import { listWorkOrders } from "@/lib/uchet/order-queries";
import { OrdersBoard } from "@/components/uchet/zakazy/OrdersBoard";

export const metadata: Metadata = {
  title: "Заказы",
};

export const dynamic = "force-dynamic";

/**
 * Заказы с сайта — в учёте, рядом с кассой и витриной. Действия те же, что
 * в админке сайта (статус, отметка «принят», фото клиенту), поэтому и доступ
 * тот же: canUseSiteOrders.
 */
export default async function ZakazyPage() {
  await requireStaffUser("/uchet/zakazy", canUseSiteOrders);
  const { work, awaitingPayment, doneToday } = await listWorkOrders();
  return <OrdersBoard work={work} awaitingPayment={awaitingPayment} doneToday={doneToday} />;
}
