"use client";

import { useState } from "react";
import Link from "next/link";
import type { HallSale } from "@/lib/uchet/order-queries";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { CloseButton, Panel } from "@/components/uchet/Overlay";

const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Simferopol" });

const shift = (day: string, n: number) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

function dayTitle(day: string, today: string): string {
  if (day === today) return "Сегодня";
  if (day === shift(today, -1)) return "Вчера";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" });
}

/**
 * Продажи в зале за день: каждый чек — когда, что, на сколько, как
 * заплатили, кто продал. Оплаты заказов здесь же, с номером заказа: это
 * тоже деньги дня. Возвращённые — бледнее и в итог не входят.
 */
export function HallSales({ sales, day, today }: { sales: HallSale[]; day: string; today: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const paid = sales.filter((s) => s.status === "paid");
  const total = paid.reduce((sum, s) => sum + s.total, 0);
  const byMethod = new Map<string, number>();
  for (const s of paid) for (const p of s.payments) byMethod.set(p.title, (byMethod.get(p.title) ?? 0) + p.amount);
  const open = openId ? sales.find((s) => s.id === openId) ?? null : null;

  const link = (d: string) => `/uchet/zakazy?tab=sales&day=${d}`;

  return (
    <div className={ui.page}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={link(shift(day, -1))} className={`${ui.btnSecondary} min-h-[40px] px-3`} aria-label="Предыдущий день">
            ←
          </Link>
          <span className="min-w-[9rem] text-center font-display text-base font-semibold">{dayTitle(day, today)}</span>
          {day < today ? (
            <Link href={link(shift(day, 1))} className={`${ui.btnSecondary} min-h-[40px] px-3`} aria-label="Следующий день">
              →
            </Link>
          ) : (
            <span className="w-[42px]" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
          <span>
            <span className="font-display text-xl font-bold tabular-nums">{formatMoney(total)}</span> <span className="text-zinc-500">· {paid.length} чек.</span>
          </span>
          {[...byMethod.entries()].map(([t, a]) => (
            <span key={t} className="text-zinc-600">
              {t} <span className="font-semibold tabular-nums text-zinc-900">{formatMoney(a)}</span>
            </span>
          ))}
        </div>
      </div>

      {sales.length === 0 ? (
        <section className={`${ui.cardPad} mt-6 text-center text-sm text-zinc-500`}>За этот день продаж нет.</section>
      ) : (
        <ul className={`${ui.card} mt-4 divide-y divide-zinc-100`}>
          {sales.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpenId(s.id)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-lavender-50/40 ${s.status === "returned" ? "opacity-50" : ""}`}>
                <span className="w-12 shrink-0 font-display text-sm font-semibold tabular-nums">{timeFmt.format(new Date(s.at))}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900">{s.lines.map((l) => (l.qty > 1 ? `${l.title} × ${l.qty}` : l.title)).join(", ")}</span>
                  <span className="block text-xs text-zinc-500">
                    {s.saleNo}
                    {s.who ? ` · ${s.who}` : ""} · {s.payments.map((p) => p.title).join(" + ")}
                    {s.discountPercent > 0 && ` · скидка ${s.discountPercent}%`}
                    {s.status === "returned" && " · возврат"}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(s.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <Panel label={`Чек ${open.saleNo}`} onClose={() => setOpenId(null)}>
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5">
            <div>
              <h2 className="font-display text-lg font-semibold">
                {open.saleNo} · {timeFmt.format(new Date(open.at))}
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                {open.who ? `продажа: ${open.who}` : "продажа"}
                {open.status === "returned" && " · возвращён"}
              </p>
            </div>
            <CloseButton onClose={() => setOpenId(null)} />
          </div>
          <div className="space-y-4 p-5">
            <ul className="divide-y divide-zinc-100 text-sm">
              {open.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span>
                    {l.title}
                    {l.qty > 1 && <span className="text-zinc-500"> × {l.qty}</span>}
                    {l.kind === "vitrine" && <span className="block text-xs text-zinc-500">с витрины</span>}
                  </span>
                  <span className="tabular-nums">{formatMoney(l.amount)}</span>
                </li>
              ))}
            </ul>
            {open.discountPercent > 0 && <p className="text-sm text-zinc-600">Скидка {open.discountPercent}%</p>}
            <div className="flex items-baseline justify-between border-t border-zinc-200 pt-3">
              <span className={ui.label}>Итого</span>
              <span className="font-display text-2xl font-bold tabular-nums">{formatMoney(open.total)}</span>
            </div>
            <ul className="space-y-1 text-sm text-zinc-600">
              {open.payments.map((p, i) => (
                <li key={i} className="flex justify-between">
                  <span>{p.title}</span>
                  <span className="tabular-nums">{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      )}
    </div>
  );
}
