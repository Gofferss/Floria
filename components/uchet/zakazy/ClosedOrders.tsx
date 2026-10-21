"use client";

import { useMemo, useState } from "react";
import type { WorkOrder } from "@/lib/uchet/order-queries";
import type { PaymentMethodOption } from "@/lib/uchet/pos-queries";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { OrderPanel } from "@/components/uchet/zakazy/OrdersBoard";
import { ShopOrderPanel } from "@/components/uchet/zakazy/ShopOrderPanel";

type Filter = "all" | "debt" | "cancelled";

const closedFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Simferopol" });

const debtOf = (o: WorkOrder) => (o.source === "shop" && o.status === "completed" ? Math.max(0, o.total - o.paidAmount) : 0);

/**
 * Выполненные заказы за две недели: доставлены, выданы, отменены. Здесь
 * же долги — заказ магазина отдали, а оплатили не всё: долг виден сразу и
 * оплату по нему принимают из карточки.
 */
export function ClosedOrders({ orders, methods, shiftOpen }: { orders: WorkOrder[]; methods: PaymentMethodOption[]; shiftOpen: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const debts = orders.filter((o) => debtOf(o) > 0);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return orders.filter((o) => {
      if (filter === "debt" && debtOf(o) === 0) return false;
      if (filter === "cancelled" && o.status !== "cancelled") return false;
      if (!q) return true;
      return (
        o.number.toLowerCase().includes(q) ||
        o.recipientName.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        (o.address ?? "").toLowerCase().includes(q) ||
        (digits.length >= 3 && (o.recipientPhone.replace(/\D/g, "").includes(digits) || o.customerPhone.replace(/\D/g, "").includes(digits)))
      );
    });
  }, [orders, query, filter]);

  const open = openId ? orders.find((o) => o.id === openId) ?? null : null;

  return (
    <div className={ui.page}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="closed-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Номер, имя, телефон, адрес"
          aria-label="Поиск по заказам"
          className={`${ui.field} min-w-0 flex-1 sm:max-w-xs`}
        />
        {(
          [
            ["all", `Все · ${orders.length}`],
            ["debt", `С долгом · ${debts.length}`],
            ["cancelled", `Отменённые · ${orders.filter((o) => o.status === "cancelled").length}`],
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            aria-pressed={filter === k}
            className={`${ui.chip} ${filter === k ? ui.chipOn : k === "debt" && debts.length ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200" : ui.chipOff}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-zinc-500">За последние две недели. Старые заказы сайта — в админке сайта.</p>

      {list.length === 0 ? (
        <section className={`${ui.cardPad} mt-4 text-center text-sm text-zinc-500`}>Ничего не нашлось.</section>
      ) : (
        <ul className={`${ui.card} mt-4 divide-y divide-zinc-100`}>
          {list.map((o) => {
            const debt = debtOf(o);
            return (
              <li key={`${o.source}-${o.id}`}>
                <button type="button" onClick={() => setOpenId(o.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-lavender-50/40">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-zinc-900">
                      {o.number} · {o.recipientName}
                      <span className="font-normal text-zinc-500"> · {o.isPickup ? "самовывоз" : o.address ?? "доставка"}</span>
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {o.status === "cancelled" ? "отменён" : o.isPickup ? "выдан" : "доставлен"}
                      {o.closedAt ? ` ${closedFmt.format(new Date(o.closedAt))}` : ""} · {o.source === "site" ? "с сайта" : "магазин"}
                      {o.cancelReason ? ` · ${o.cancelReason}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums">{formatMoney(o.total)}</span>
                    {debt > 0 && <span className="block text-xs font-bold text-red-600">долг {formatMoney(debt)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open &&
        (open.source === "shop" ? (
          <ShopOrderPanel order={open} methods={methods} shiftOpen={shiftOpen} onClose={() => setOpenId(null)} />
        ) : (
          <OrderPanel order={open} onClose={() => setOpenId(null)} />
        ))}
    </div>
  );
}
