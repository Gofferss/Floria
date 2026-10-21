"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { courierAdvance } from "@/lib/uchet/order-actions";
import type { WorkOrder } from "@/lib/uchet/order-queries";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";

const STATUS_LABEL: Record<string, string> = {
  new: "Новый",
  confirmed: "Принят",
  assembling: "Собирается",
  ready: "Собран — можно забирать",
  delivering: "Везу",
};

function mapsLink(address: string): string {
  return `https://yandex.ru/maps/?text=${encodeURIComponent(`Симферополь, ${address}`)}`;
}

/**
 * Доставки для курьера с телефона: куда, во сколько, кому звонить и две
 * кнопки — «Забрал, везу» и «Доставил». Клиенту в бот уходит то же
 * сообщение, что и при смене статуса из админки.
 */
export function DeliveryList({ days }: { days: { title: string; orders: WorkOrder[] }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function mark(o: WorkOrder, to: "delivering" | "completed") {
    setBusy(o.id);
    const result = await courierAdvance(o.id, to);
    setBusy(null);
    if (!result.success) return toast({ tone: "error", text: result.error });
    toast({ tone: "ok", text: to === "delivering" ? `${o.number}: в пути` : `${o.number}: доставлен` });
    router.refresh();
  }

  return (
    <div className={`${ui.page} max-w-3xl space-y-6`}>
      {days.map((d) => (
        <section key={d.title}>
          <h1 className={`${ui.label} mb-2`}>
            {d.title} · {d.orders.length}
          </h1>
          {d.orders.length === 0 ? (
            <p className={`${ui.card} px-5 py-6 text-center text-sm text-zinc-500`}>Доставок нет</p>
          ) : (
            <ul className="space-y-2">
              {d.orders.map((o) => (
                <li key={o.id} className={`${ui.card} p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-display text-lg font-semibold tabular-nums">
                      {o.timeFrom ?? "—"}
                      {o.timeTo ? `–${o.timeTo}` : ""}
                    </p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${o.status === "ready" ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-700"}`}>
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </div>
                  {o.address ? (
                    <a href={mapsLink(o.address)} target="_blank" rel="noreferrer" className="mt-1 block text-[15px] font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4">
                      {o.address}
                    </a>
                  ) : (
                    <p className="mt-1 text-[15px] text-zinc-500">Адрес не указан — позвоните получателю</p>
                  )}
                  {o.addressExtra && <p className="text-sm text-zinc-600">{o.addressExtra}</p>}
                  <p className="mt-2 text-sm">
                    {o.recipientName} ·{" "}
                    <a href={`tel:${o.recipientPhone}`} className="font-semibold text-lavender-700 underline underline-offset-2">
                      {o.recipientPhone}
                    </a>
                  </p>
                  {o.courierComment && <p className="mt-1 text-sm text-zinc-600">«{o.courierComment}»</p>}
                  <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Оплачено — деньги не брать</p>
                  <div className="mt-3">
                    {o.status === "delivering" ? (
                      <button type="button" disabled={busy === o.id} onClick={() => mark(o, "completed")} className={`${ui.btnPrimary} min-h-[52px] w-full text-base`}>
                        {busy === o.id ? "…" : "Доставил"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === o.id}
                        onClick={() => mark(o, "delivering")}
                        className={`${o.status === "ready" ? ui.btnPrimary : ui.btnSecondary} min-h-[52px] w-full text-base`}
                      >
                        {busy === o.id ? "…" : o.status === "ready" ? "Забрал — везу" : "Забрал — везу (букет ещё не отмечен собранным)"}
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-zinc-400">{o.number}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
