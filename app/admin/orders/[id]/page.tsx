import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { OrderStatusControl } from "@/components/admin/orders/OrderStatusControl";
import type { OrderStatus } from "@/lib/actions/orders";

export const metadata: Metadata = {
  title: "Заказ — Админка Floria",
};

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type OrderDetail = {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: string;
  customer_name: string;
  customer_phone: string;
  recipient_name: string;
  recipient_phone: string;
  is_recipient_self: boolean;
  is_pickup: boolean;
  delivery_city: string;
  delivery_address: string | null;
  delivery_apartment: string | null;
  delivery_entrance: string | null;
  delivery_floor: string | null;
  delivery_intercom_code: string | null;
  delivery_date: string;
  delivery_time_from: string | null;
  delivery_time_to: string | null;
  courier_comment: string | null;
  card_text: string | null;
  items_total: number;
  delivery_price: number;
  discount_total: number;
  bonus_used: number;
  bonus_earned: number;
  total_amount: number;
  admin_comment: string | null;
  created_at: string;
};

type OrderItemRow = {
  id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  total_price: number;
};

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function timeRangeLabel(from: string | null, to: string | null): string {
  if (!from || !to) return "Как можно скорее";
  return `${from.slice(0, 5)}–${to.slice(0, 5)}`;
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffUser();

  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const [{ data: order, error: orderError }, { data: items, error: itemsError }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("order_items")
      .select("id, product_name, unit_price, quantity, total_price")
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (orderError) console.error("[AdminOrderDetailPage] order", orderError.message);
  if (itemsError) console.error("[AdminOrderDetailPage] items", itemsError.message);
  if (!order) notFound();

  const detail = order as OrderDetail;
  const orderItems = (items ?? []) as OrderItemRow[];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <Link
        href="/admin/orders"
        className="mb-6 inline-flex items-center gap-1 font-body text-sm text-ink/50 transition hover:text-ink"
      >
        ← Все заказы
      </Link>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
            Заказ
          </span>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">{detail.order_number}</h1>
          <p className="mt-1 font-body text-xs text-ink/40">
            Оформлен {dateTimeFormatter.format(new Date(detail.created_at))}
          </p>
        </div>
        <OrderStatusControl orderId={detail.id} status={detail.status} />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-3xl border border-lavender-100 bg-white p-6">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink/50">Клиент</h2>
          <p className="mt-3 font-body text-sm text-ink">{detail.customer_name}</p>
          <p className="font-body text-sm text-ink/60">{detail.customer_phone}</p>

          {!detail.is_recipient_self && (
            <>
              <h2 className="mt-5 font-display text-sm font-semibold uppercase tracking-wide text-ink/50">
                Получатель
              </h2>
              <p className="mt-3 font-body text-sm text-ink">{detail.recipient_name}</p>
              <p className="font-body text-sm text-ink/60">{detail.recipient_phone}</p>
            </>
          )}
        </section>

        <section className="rounded-3xl border border-lavender-100 bg-white p-6">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink/50">Доставка</h2>
          <p className="mt-3 font-body text-sm text-ink">
            {dateTimeFormatter.format(new Date(detail.delivery_date))}, {timeRangeLabel(detail.delivery_time_from, detail.delivery_time_to)}
          </p>
          {detail.is_pickup ? (
            <p className="mt-1 font-body text-sm text-ink/60">Самовывоз</p>
          ) : (
            <p className="mt-1 font-body text-sm text-ink/60">
              {detail.delivery_city}, {detail.delivery_address}
              {detail.delivery_apartment && `, кв. ${detail.delivery_apartment}`}
              {detail.delivery_entrance && `, подъезд ${detail.delivery_entrance}`}
              {detail.delivery_floor && `, этаж ${detail.delivery_floor}`}
              {detail.delivery_intercom_code && `, домофон ${detail.delivery_intercom_code}`}
            </p>
          )}
          {detail.courier_comment && (
            <p className="mt-3 rounded-xl bg-lavender-50/60 p-3 font-body text-sm text-ink/70">
              <span className="font-semibold text-ink/50">Комментарий курьеру: </span>
              {detail.courier_comment}
            </p>
          )}
          {detail.card_text && (
            <p className="mt-3 rounded-xl bg-gold-500/5 p-3 font-body text-sm text-ink/70">
              <span className="font-semibold text-ink/50">Текст открытки: </span>
              {detail.card_text}
            </p>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-3xl border border-lavender-100 bg-white p-6">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink/50">Состав заказа</h2>
        <ul className="mt-4 flex flex-col gap-3">
          {orderItems.map((item) => (
            <li key={item.id} className="flex items-center justify-between font-body text-sm">
              <span className="text-ink">
                {item.product_name} <span className="text-ink/40">× {item.quantity}</span>
              </span>
              <span className="text-ink/60">{currency.format(item.total_price)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-col gap-1.5 border-t border-lavender-100 pt-4 font-body text-sm">
          <div className="flex justify-between text-ink/60">
            <span>Товары</span>
            <span>{currency.format(detail.items_total)}</span>
          </div>
          <div className="flex justify-between text-ink/60">
            <span>Доставка</span>
            <span>{currency.format(detail.delivery_price)}</span>
          </div>
          {detail.discount_total > 0 && (
            <div className="flex justify-between text-ink/60">
              <span>Скидка</span>
              <span>−{currency.format(detail.discount_total)}</span>
            </div>
          )}
          {detail.bonus_used > 0 && (
            <div className="flex justify-between text-ink/60">
              <span>Списано бонусов</span>
              <span>−{currency.format(detail.bonus_used)}</span>
            </div>
          )}
          <div className="flex justify-between font-display text-base font-semibold text-ink">
            <span>Итого</span>
            <span>{currency.format(detail.total_amount)}</span>
          </div>
        </div>
      </section>

      {detail.admin_comment && (
        <p className="mt-6 font-body text-xs text-ink/40">{detail.admin_comment}</p>
      )}
    </div>
  );
}
