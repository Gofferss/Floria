"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { courierAdvance } from "@/lib/uchet/order-actions";
import type { PlanStop } from "@/lib/uchet/delivery-plan";
import { yandexPointRoute, yandexRouteLinks, type Point } from "@/lib/uchet/route";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";

const STATUS_LABEL: Record<string, string> = {
  new: "Новый",
  confirmed: "Принят",
  assembling: "Собирается",
  ready: "Собран — можно забирать",
  delivering: "Везу",
  completed: "Доставлен",
};

function searchLink(address: string): string {
  return `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;
}

/**
 * Доставки курьера с телефона — в порядке маршрута, который построили в
 * магазине. Сверху — «весь маршрут в Яндекс Картах» от того места, где
 * курьер сейчас, по оставшимся адресам. У каждой остановки — две кнопки:
 * «Забрал, везу» и «Доставил».
 */
export function DeliveryList({ days }: { days: { title: string; stops: PlanStop[] }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function mark(s: PlanStop, to: "delivering" | "completed") {
    setBusy(s.key);
    const result = await courierAdvance(s.id, to, s.source);
    setBusy(null);
    if (!result.success) return toast({ tone: "error", text: result.error });
    toast({ tone: "ok", text: to === "delivering" ? `${s.number}: в пути` : `${s.number}: доставлен` });
    router.refresh();
  }

  return (
    <div className={`${ui.page} max-w-3xl space-y-6`}>
      {days.map((d) => {
        const todo = d.stops.filter((s) => s.status !== "completed");
        const done = d.stops.filter((s) => s.status === "completed");
        const points = todo.map((s) => s.point).filter((p): p is Point => !!p);
        // От текущего места телефона — курьер мог уже отъехать от студии.
        const links = yandexRouteLinks(null, points);
        return (
          <section key={d.title}>
            <h1 className={`${ui.label} mb-2`}>
              {d.title} · {todo.length}
              {done.length > 0 && <span className="font-normal normal-case tracking-normal text-zinc-400"> · отвезено {done.length}</span>}
            </h1>
            {links.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {links.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className={`${ui.btnPrimary} min-h-[48px]`}>
                    Весь маршрут в Яндекс Картах{links.length > 1 ? ` · ${l.from}–${l.to}` : ""}
                  </a>
                ))}
              </div>
            )}
            {todo.length === 0 ? (
              <p className={`${ui.card} px-5 py-6 text-center text-sm text-zinc-500`}>{done.length ? "Всё отвезено" : "Доставок нет"}</p>
            ) : (
              <ol className="space-y-2">
                {todo.map((s, i) => (
                  <li key={s.key} className={`${ui.card} p-4`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-display text-lg font-semibold tabular-nums">
                        <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-sm text-white">{i + 1}</span>
                        {s.timeFrom ?? "в течение дня"}
                        {s.timeTo ? `–${s.timeTo}` : ""}
                      </p>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.status === "ready" ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-700"}`}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </div>
                    {s.address ? (
                      <a href={s.point ? yandexPointRoute(s.point) : searchLink(s.address)} target="_blank" rel="noreferrer" className="mt-1 block text-[15px] font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4">
                        {s.address}
                      </a>
                    ) : (
                      <p className="mt-1 text-[15px] text-zinc-500">Адрес не указан — позвоните получателю</p>
                    )}
                    {s.addressExtra && <p className="text-sm text-zinc-600">{s.addressExtra}</p>}
                    <p className="mt-2 text-sm">
                      {s.recipientName}
                      {s.recipientPhone && (
                        <>
                          {" · "}
                          <a href={`tel:${s.recipientPhone}`} className="font-semibold text-lavender-700 underline underline-offset-2">
                            {s.recipientPhone}
                          </a>
                        </>
                      )}
                    </p>
                    {s.courierComment && <p className="mt-1 text-sm text-zinc-600">«{s.courierComment}»</p>}
                    {s.testPayment ? (
                      <p className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950">Тестовая оплата с сайта — денег нет. Не везти, пока магазин не подтвердит</p>
                    ) : s.due > 0 ? (
                      <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">Взять с получателя {formatMoney(s.due)} — и передать в магазин</p>
                    ) : (
                      <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Оплачено — деньги не брать</p>
                    )}
                    <div className="mt-3">
                      {s.status === "delivering" ? (
                        <button type="button" disabled={busy === s.key} onClick={() => mark(s, "completed")} className={`${ui.btnPrimary} min-h-[52px] w-full text-base`}>
                          {busy === s.key ? "…" : "Доставил"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy === s.key}
                          onClick={() => mark(s, "delivering")}
                          className={`${s.status === "ready" ? ui.btnPrimary : ui.btnSecondary} min-h-[52px] w-full text-base`}
                        >
                          {busy === s.key ? "…" : s.status === "ready" ? "Забрал — везу" : "Забрал — везу (букет ещё не отмечен собранным)"}
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-zinc-400">{s.number}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
