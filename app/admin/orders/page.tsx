import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { OrderStatus } from "@/lib/actions/orders";
import { FloristAcceptedCheckbox } from "@/components/admin/orders/FloristAcceptedCheckbox";

export const metadata: Metadata = {
  title: "Заказы — Админка Floria",
};

// Список должен сразу отражать смену статуса — без ISR.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type AdminOrderRow = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  status: OrderStatus;
  total_amount: number;
  delivery_date: string;
  created_at: string;
  florist_accepted_at: string | null;
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  assembling: "Собирается",
  ready: "Готов к отправке",
  delivering: "В доставке",
  completed: "Доставлен",
  cancelled: "Отменён",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  new: "bg-lavender-100 text-lavender-700",
  confirmed: "bg-lavender-100 text-lavender-700",
  assembling: "bg-gold-500/10 text-gold-700",
  ready: "bg-gold-500/10 text-gold-700",
  delivering: "bg-gold-500/10 text-gold-700",
  completed: "bg-green-50 text-green-700",
  cancelled: "bg-red-50 text-red-700",
};

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

export default async function AdminOrdersListPage() {
  await requireStaffUser();

  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select(
      "id, order_number, customer_name, customer_phone, status, total_amount, delivery_date, created_at, florist_accepted_at"
    )
    .order("created_at", { ascending: false });

  if (error) console.error("[AdminOrdersListPage]", error.message);

  const orders = (data ?? []) as AdminOrderRow[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Админка
        </span>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Заказы</h1>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-lavender-200 px-6 py-20 text-center">
          <p className="font-display text-lg font-semibold text-ink">Заказов пока нет</p>
          <p className="mt-1 max-w-sm mx-auto font-body text-sm text-ink/50">
            Здесь появится каждый заказ с сайта.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-lavender-100 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-lavender-100 bg-lavender-50/60">
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Заказ
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Клиент
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Доставка
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Сумма
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Статус
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Флорист
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-lavender-50 transition last:border-0 hover:bg-lavender-50/50"
                  >
                    <td className="px-5 py-4">
                      <Link href={`/admin/orders/${order.id}`} className="group block">
                        <span className="block font-display text-sm font-semibold text-ink transition group-hover:text-gold-600">
                          {order.order_number}
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <span className="block font-body text-sm text-ink/70">{order.customer_name}</span>
                      <span className="block font-body text-xs text-ink/40">{order.customer_phone}</span>
                    </td>
                    <td className="px-5 py-4 font-body text-sm text-ink/60">
                      {dateFormatter.format(new Date(order.delivery_date))}
                    </td>
                    <td className="px-5 py-4 font-body text-sm text-ink/60">{currency.format(order.total_amount)}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 font-body text-xs font-medium ${STATUS_CLASS[order.status]}`}
                      >
                        {STATUS_LABEL[order.status]}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <FloristAcceptedCheckbox orderId={order.id} accepted={!!order.florist_accepted_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
