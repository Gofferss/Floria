"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moveStop, planDay, setStopCourier } from "@/lib/uchet/route-actions";
import type { Courier, PlanStop } from "@/lib/uchet/delivery-plan";
import { routeLengthKm, yandexRouteLinks, type Point } from "@/lib/uchet/route";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";

// ================================================================
// План доставок на день. Обычно курьер один, в праздники — два-три: тогда
// одной кнопкой доставки раскладываются по курьерам секторами от студии
// (соседние адреса — одному человеку), а у каждого строится порядок:
// окна времени по очереди, внутри окна — ближайший адрес. Дальше можно
// поправить руками: другой курьер, выше, ниже.
// ================================================================

const STATUS: Record<string, string> = {
  new: "новый",
  confirmed: "принят",
  assembling: "собирается",
  ready: "собран",
  delivering: "в пути",
  completed: "доставлен",
};

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" });
const dayAt = (n: number) => dayFmt.format(new Date(Date.now() + n * 86_400_000));

const windowLabel = (s: PlanStop) => (s.timeFrom && s.timeTo ? `${s.timeFrom}–${s.timeTo}` : s.timeFrom ? `к ${s.timeFrom}` : "в течение дня");
const bySeq = (a: PlanStop, b: PlanStop) => (a.seq ?? 999) - (b.seq ?? 999) || (a.timeFrom ?? "99").localeCompare(b.timeFrom ?? "99");

type Props = {
  day: string;
  stops: PlanStop[];
  couriers: Courier[];
  start: Point;
  hasKey: boolean;
};

export function DeliveryPlanner({ day, stops, couriers, start, hasKey }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [chosen, setChosen] = useState<string[]>(couriers.map((c) => c.id));
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"routes" | "assembly">("routes");

  const withoutPoint = stops.filter((s) => !s.point && s.address).length;
  const active = stops.filter((s) => s.status !== "completed");
  const groups = [
    ...couriers.map((c) => ({ id: c.id as string | null, title: c.name, list: stops.filter((s) => s.courierId === c.id).sort(bySeq) })),
    { id: null, title: "Не распределены", list: stops.filter((s) => !s.courierId || !couriers.some((c) => c.id === s.courierId)).sort(bySeq) },
  ].filter((g) => g.id !== null || g.list.length > 0);

  async function plan() {
    setBusy(true);
    const r = await planDay(day, chosen);
    setBusy(false);
    if (!r.success) return toast({ tone: "error", text: r.error });
    toast({
      tone: "ok",
      text: `Разложено ${r.data.planned}${r.data.withoutPoint ? ` · ${r.data.withoutPoint} без точки на карте — поставлены по времени` : ""}`,
    });
    router.refresh();
  }

  async function run(fn: () => Promise<{ success: true } | { success: false; error: string }>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.success) return toast({ tone: "error", text: r.error });
    router.refresh();
  }

  const go = (d: string) => router.push(`/uchet/dostavki?day=${d}`);

  return (
    <div className={ui.page}>
      <div className="flex flex-wrap items-center gap-2">
        {[
          ["Сегодня", dayAt(0)],
          ["Завтра", dayAt(1)],
          ["Послезавтра", dayAt(2)],
        ].map(([label, d]) => (
          <button key={d} type="button" onClick={() => go(d)} aria-pressed={day === d} className={`${ui.chip} ${day === d ? ui.chipOn : ui.chipOff}`}>
            {label}
          </button>
        ))}
        <input type="date" value={day} onChange={(e) => e.target.value && go(e.target.value)} aria-label="День" className={ui.fieldInline} />
        <span className="ml-auto text-sm text-zinc-500">
          {stops.length} доставок · ещё не отвезено {active.length}
        </span>
      </div>

      {!hasKey && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Адреса пока не превращаются в точки на карте: не подключён ключ DaData. Порядок строится только по времени. Как подключить — в
          инструкции, которую я прислал.
        </p>
      )}
      {hasKey && withoutPoint > 0 && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {withoutPoint} {withoutPoint === 1 ? "адрес не нашёлся" : "адреса не нашлись"} на карте — проверьте адрес в заказе. Такие доставки
          ставятся в маршрут по времени.
        </p>
      )}

      <section className={`${ui.cardPad} mt-4`}>
        {couriers.length === 0 ? (
          <p className="text-sm text-zinc-600">
            Курьеров пока нет. Заведите каждому вход с ролью «Курьер» в{" "}
            <Link href="/uchet/lyudi" className="font-semibold text-lavender-700 underline">
              «Сотрудниках»
            </Link>{" "}
            — тогда доставки можно будет раскладывать между ними.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-zinc-700">Кто везёт:</span>
            {couriers.map((c) => {
              const on = chosen.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChosen((x) => (on ? x.filter((i) => i !== c.id) : [...x, c.id]))}
                  aria-pressed={on}
                  className={`${ui.chip} ${on ? "bg-lavender-600 text-white" : ui.chipOff}`}
                >
                  {c.name}
                </button>
              );
            })}
            <button type="button" disabled={busy || chosen.length === 0 || active.length === 0} onClick={plan} className={`${ui.btnPrimary} ml-auto`}>
              {busy ? "Считаем…" : chosen.length > 1 ? `Разложить на ${chosen.length} и построить маршруты` : "Построить маршрут"}
            </button>
          </div>
        )}
      </section>

      <div className="mt-4 flex gap-2" role="group" aria-label="Вид">
        <button type="button" onClick={() => setView("routes")} aria-pressed={view === "routes"} className={`${ui.chip} ${view === "routes" ? ui.chipOn : ui.chipOff}`}>
          Маршруты курьеров
        </button>
        <button type="button" onClick={() => setView("assembly")} aria-pressed={view === "assembly"} className={`${ui.chip} ${view === "assembly" ? ui.chipOn : ui.chipOff}`}>
          Порядок сборки
        </button>
      </div>

      {view === "routes" ? (
        <div className={`mt-4 grid gap-4 ${groups.length >= 3 ? "lg:grid-cols-3" : groups.length === 2 ? "lg:grid-cols-2" : ""}`}>
          {groups.map((g) => {
            const todo = g.list.filter((s) => s.status !== "completed");
            const points = todo.map((s) => s.point).filter((p): p is Point => !!p);
            const links = g.id ? yandexRouteLinks(start, points) : [];
            const km = routeLengthKm(start, todo.map((s) => s.point));
            return (
              <section key={g.id ?? "none"} className={ui.card}>
                <header className="border-b border-zinc-100 px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className={ui.h2}>{g.title}</h2>
                    <span className="text-sm text-zinc-500">
                      {g.list.length} {km > 0 && `· ≈ ${Math.round(km)} км по прямой`}
                    </span>
                  </div>
                  {links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {links.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="rounded-lg bg-lavender-50 px-3 py-1.5 text-sm font-semibold text-lavender-700 hover:bg-lavender-100">
                          Маршрут в Яндекс Картах{links.length > 1 ? ` · ${l.from}–${l.to}` : ""} ↗
                        </a>
                      ))}
                    </div>
                  )}
                </header>
                <ol className="divide-y divide-zinc-100">
                  {g.list.map((s, i) => (
                    <li key={s.key} className={`flex gap-3 px-4 py-3 ${s.status === "completed" ? "opacity-50" : ""}`}>
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-bold tabular-nums">{g.id ? i + 1 : "·"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {windowLabel(s)} <span className="font-normal text-zinc-500">· {s.number} · {STATUS[s.status] ?? s.status}</span>
                        </p>
                        <p className="truncate text-sm text-zinc-800">{s.address ?? "адрес не указан"}</p>
                        <p className="text-xs text-zinc-500">
                          {s.recipientName}
                          {!s.point && s.address && <span className="font-semibold text-amber-700"> · нет на карте</span>}
                          {s.point && s.quality !== null && s.quality >= 2 && <span className="text-amber-700"> · точка — по улице</span>}
                          {s.due > 0 && <span className="font-semibold text-red-600"> · взять {formatMoney(s.due)}</span>}
                        </p>
                        {s.status !== "completed" && s.status !== "delivering" && couriers.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {g.id && (
                              <>
                                <button type="button" disabled={busy || i === 0} onClick={() => run(() => moveStop(day, s.key, -1))} className="h-8 w-8 rounded-lg bg-zinc-100 text-sm disabled:opacity-30" aria-label="Выше">
                                  ↑
                                </button>
                                <button type="button" disabled={busy || i === g.list.length - 1} onClick={() => run(() => moveStop(day, s.key, 1))} className="h-8 w-8 rounded-lg bg-zinc-100 text-sm disabled:opacity-30" aria-label="Ниже">
                                  ↓
                                </button>
                              </>
                            )}
                            <select
                              value={s.courierId ?? ""}
                              disabled={busy}
                              onChange={(e) => run(() => setStopCourier(day, s.key, e.target.value || null))}
                              aria-label="Курьер"
                              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs"
                            >
                              <option value="">не распределён</option>
                              {couriers.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                  {g.list.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-400">Пусто</li>}
                </ol>
              </section>
            );
          })}
        </div>
      ) : (
        <AssemblyOrder stops={active} couriers={couriers} />
      )}
    </div>
  );
}

/**
 * Порядок сборки: что уезжает раньше — то и собирать раньше. Внутри окна —
 * по номеру остановки у курьера: первая остановка уезжает первой.
 */
function AssemblyOrder({ stops, couriers }: { stops: PlanStop[]; couriers: Courier[] }) {
  const name = (id: string | null) => couriers.find((c) => c.id === id)?.name ?? "не распределён";
  const list = [...stops].sort(
    (a, b) => (a.timeFrom ?? "99").localeCompare(b.timeFrom ?? "99") || (a.seq ?? 999) - (b.seq ?? 999)
  );
  return (
    <section className={`${ui.card} mt-4`}>
      <p className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-600">Собирайте сверху вниз: первыми — те, что уезжают первыми.</p>
      <ol className="divide-y divide-zinc-100">
        {list.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="w-6 text-right font-bold tabular-nums text-zinc-400">{i + 1}</span>
            <span className="w-24 shrink-0 font-semibold tabular-nums">{s.timeFrom ? `к ${s.timeFrom}` : "в теч. дня"}</span>
            <span className="min-w-0 flex-1 truncate">
              {s.number} · {s.address ?? "—"}
            </span>
            <span className="shrink-0 text-zinc-500">
              {name(s.courierId)}
              {s.seq ? ` · №${s.seq}` : ""}
            </span>
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold">{STATUS[s.status] ?? s.status}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
