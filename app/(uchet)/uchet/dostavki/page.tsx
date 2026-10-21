import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canEnterUchet } from "@/lib/auth/roles";
import { getSupabaseAdmin } from "@/lib/supabase";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";

export const metadata: Metadata = {
  title: "Доставки",
};

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  new: "Новый",
  confirmed: "Принят",
  assembling: "Собирается",
  ready: "Собран",
  delivering: "В доставке",
};

function todayAt(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" }).format(d);
}

/**
 * Доставки на сегодня и завтра — для курьера с телефона. Пока только
 * список: куда, во сколько, кому звонить и оплачено ли. Отметки «забрал»
 * и «доставил» появятся вместе с заказами в учёте.
 */
export default async function DeliveriesPage() {
  await requireStaffUser("/uchet/dostavki", canEnterUchet);
  const today = todayAt(0);
  const tomorrow = todayAt(1);

  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select(
      "id, order_number, delivery_date, delivery_time_from, delivery_time_to, delivery_address, delivery_entrance, delivery_floor, delivery_apartment, delivery_intercom_code, courier_comment, recipient_name, recipient_phone, status, payment_status, total_amount"
    )
    .eq("is_pickup", false)
    .in("status", ["new", "confirmed", "assembling", "ready", "delivering"])
    .in("delivery_date", [today, tomorrow])
    .order("delivery_date")
    .order("delivery_time_from", { nullsFirst: false });
  if (error) throw new Error(`Доставки: ${error.message}`);

  const days = [
    { date: today, title: "Сегодня" },
    { date: tomorrow, title: "Завтра" },
  ];

  return (
    <div className={`${ui.page} max-w-3xl space-y-6`}>
      {days.map((d) => {
        const list = (data ?? []).filter((o) => o.delivery_date === d.date);
        return (
          <section key={d.date}>
            <h1 className={`${ui.label} mb-2`}>
              {d.title} · {list.length}
            </h1>
            {list.length === 0 ? (
              <p className={`${ui.card} px-5 py-6 text-center text-sm text-zinc-500`}>Доставок нет</p>
            ) : (
              <ul className="space-y-2">
                {list.map((o) => {
                  const paid = o.payment_status === "paid";
                  const extra = [
                    o.delivery_apartment && `кв. ${o.delivery_apartment}`,
                    o.delivery_entrance && `подъезд ${o.delivery_entrance}`,
                    o.delivery_floor && `этаж ${o.delivery_floor}`,
                    o.delivery_intercom_code && `домофон ${o.delivery_intercom_code}`,
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <li key={o.id} className={`${ui.card} p-4`}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-display text-base font-semibold tabular-nums">
                          {o.delivery_time_from ? o.delivery_time_from.slice(0, 5) : "—"}
                          {o.delivery_time_to ? `–${o.delivery_time_to.slice(0, 5)}` : ""}
                        </p>
                        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">{STATUS_LABEL[o.status] ?? o.status}</span>
                      </div>
                      <p className="mt-1 text-[15px] font-medium text-zinc-900">{o.delivery_address ?? "Адрес не указан"}</p>
                      {extra && <p className="text-sm text-zinc-600">{extra}</p>}
                      <p className="mt-2 text-sm">
                        {o.recipient_name} ·{" "}
                        <a href={`tel:${o.recipient_phone}`} className="font-semibold text-lavender-700 underline underline-offset-2">
                          {o.recipient_phone}
                        </a>
                      </p>
                      {o.courier_comment && <p className="mt-1 text-sm text-zinc-600">«{o.courier_comment}»</p>}
                      <p className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold ${paid ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
                        {paid ? "Оплачено — деньги не брать" : `К оплате при получении ${formatMoney(Number(o.total_amount))}`}
                      </p>
                      <p className="mt-2 text-xs text-zinc-400">{o.order_number}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
