import Link from "next/link";
import { BotanicalPattern } from "@/components/ui/BotanicalPattern";
import { ArrowRightIcon, PackageIcon } from "@/components/ui/Icons";

type OrderStatus =
  | "new"
  | "confirmed"
  | "assembling"
  | "ready"
  | "delivering"
  | "completed"
  | "cancelled";

export type AccountOrder = {
  id: string;
  order_number: string;
  status: OrderStatus;
  total_amount: number | string;
  delivery_date: string;
  created_at: string;
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
  new: "bg-lavender-50 text-lavender-700",
  confirmed: "bg-lavender-50 text-lavender-700",
  assembling: "bg-lavender-50 text-lavender-700",
  ready: "bg-lavender-50 text-lavender-700",
  delivering: "bg-lavender-50 text-lavender-700",
  completed: "bg-gold-500/10 text-gold-700",
  cancelled: "bg-red-50 text-red-700",
};

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

function toNumber(value: number | string): number {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function OrderHistoryList({ orders }: { orders: AccountOrder[] }) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-lavender-200 px-6 py-16 text-center">
        <div className="relative h-20 w-20 text-lavender-300">
          <BotanicalPattern className="h-full w-full" />
        </div>
        <div>
          <p className="font-display text-base font-semibold text-ink">
            Заказов пока нет
          </p>
          <p className="mt-1 font-body text-sm text-ink/50">
            Здесь появится история, как только вы оформите первый букет.
          </p>
        </div>
        <Link
          href="/catalog"
          className="mt-2 inline-flex items-center gap-2 rounded-full bg-gold-500 px-6 py-3 font-display text-sm font-semibold text-white transition hover:bg-gold-600"
        >
          Смотреть каталог
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {orders.map((order) => (
        <li
          key={order.id}
          className="flex flex-col gap-3 rounded-2xl border border-lavender-100 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lavender-50 text-lavender-600">
              <PackageIcon className="h-4 w-4" />
            </span>
            <div>
              <p className="font-display text-sm font-semibold text-ink">
                {order.order_number}
              </p>
              <p className="mt-0.5 font-body text-xs text-ink/50">
                Доставка {dateFormatter.format(new Date(order.delivery_date))}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <span
              className={`rounded-full px-3 py-1 font-display text-xs font-semibold ${STATUS_CLASS[order.status]}`}
            >
              {STATUS_LABEL[order.status]}
            </span>
            <span className="font-display text-sm font-semibold text-ink">
              {currency.format(toNumber(order.total_amount))}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
