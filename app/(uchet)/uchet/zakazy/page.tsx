import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { canUseSiteOrders } from "@/lib/auth/roles";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { getOpenShift, listPaymentMethods } from "@/lib/uchet/pos-queries";
import { listClosedOrders, listHallSales, listWorkOrders, studioDate } from "@/lib/uchet/order-queries";
import { OrdersBoard } from "@/components/uchet/zakazy/OrdersBoard";
import { HallSales } from "@/components/uchet/zakazy/HallSales";
import { ClosedOrders } from "@/components/uchet/zakazy/ClosedOrders";

export const metadata: Metadata = {
  title: "Заказы",
};

export const dynamic = "force-dynamic";

type Tab = "work" | "sales" | "done";

const TABS: { key: Tab; label: string }[] = [
  { key: "work", label: "В работе" },
  { key: "sales", label: "Продажи в зале" },
  { key: "done", label: "Выполненные" },
];

/**
 * Заказы и продажи — в одном разделе, тремя вкладками: что предстоит
 * (доставки и самовывоз по дням), что продано в зале за день и что уже
 * выполнено (с долгами). Доступ — как к заказам сайта (canUseSiteOrders).
 */
export default async function ZakazyPage({ searchParams }: { searchParams: Promise<{ tab?: string; day?: string }> }) {
  await requireStaffUser("/uchet/zakazy", canUseSiteOrders);
  const params = await searchParams;
  const tab: Tab = params.tab === "sales" || params.tab === "done" ? params.tab : "work";
  const today = studioDate(0);
  const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) && params.day <= today ? params.day : today;

  const location = await getDefaultLocation();
  const [methods, shift] = await Promise.all([listPaymentMethods(), getOpenShift(location.id)]);

  let body: React.ReactNode;
  if (tab === "sales") {
    body = <HallSales sales={await listHallSales(location.id, day)} day={day} today={today} />;
  } else if (tab === "done") {
    body = <ClosedOrders orders={await listClosedOrders(location.id)} methods={methods} shiftOpen={!!shift} />;
  } else {
    const { work, awaitingPayment, doneToday } = await listWorkOrders(location.id);
    body = <OrdersBoard work={work} awaitingPayment={awaitingPayment} doneToday={doneToday} methods={methods} shiftOpen={!!shift} />;
  }

  return (
    <>
      <nav className="mx-auto flex w-full max-w-[1400px] gap-1 px-4 pt-4 sm:px-6 lg:px-8" aria-label="Вкладки заказов">
        <div className="flex rounded-xl bg-zinc-200/70 p-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/uchet/zakazy${t.key === "work" ? "" : `?tab=${t.key}`}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === t.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
      {body}
    </>
  );
}
