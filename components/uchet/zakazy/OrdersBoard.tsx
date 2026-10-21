"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setOrderFloristAccepted, updateOrderStatus, type OrderStatus } from "@/lib/actions/orders";
import type { WorkOrder } from "@/lib/uchet/order-queries";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { CloseButton, Panel } from "@/components/uchet/Overlay";
import { AssembledPhoto } from "@/components/admin/orders/AssembledPhoto";
import type { PaymentMethodOption } from "@/lib/uchet/pos-queries";
import { ShopOrderPanel } from "@/components/uchet/zakazy/ShopOrderPanel";
import { ShopOrderForm } from "@/components/uchet/zakazy/ShopOrderForm";

// ================================================================
// Заказы по дням, а не таблицей: во сколько и оплачен ли — главное, и оно
// должно читаться с одного взгляда. Касание по карточке — панель справа со
// всем о заказе и следующим шагом одной кнопкой.
// ================================================================

const STATUS_LABEL: Record<WorkOrder["status"], string> = {
  new: "Новый",
  confirmed: "Принят",
  assembling: "Собирается",
  ready: "Собран",
  delivering: "У курьера",
  completed: "Доставлен",
  cancelled: "Отменён",
};

type Step = { to: OrderStatus; label: string };

/** Следующий шаг: у доставки и самовывоза пути расходятся после «Собран». */
function nextStep(o: WorkOrder): Step | null {
  switch (o.status) {
    case "new":
      return { to: "confirmed", label: "Принять в работу" };
    case "confirmed":
      return { to: "assembling", label: "Начать сборку" };
    case "assembling":
      return { to: "ready", label: "Собран" };
    case "ready":
      return o.isPickup ? { to: "completed", label: "Выдан клиенту" } : { to: "delivering", label: "Передан курьеру" };
    case "delivering":
      return { to: "completed", label: "Доставлен" };
    default:
      return null;
  }
}

const PATH_DELIVERY: WorkOrder["status"][] = ["new", "confirmed", "assembling", "ready", "delivering", "completed"];
const PATH_PICKUP: WorkOrder["status"][] = ["new", "confirmed", "assembling", "ready", "completed"];

function timeLabel(o: WorkOrder): string {
  if (o.timeFrom && o.timeTo) return `${o.timeFrom}–${o.timeTo}`;
  if (o.timeFrom) return `к ${o.timeFrom}`;
  return "в течение дня";
}

/** Скоро время, а букет ещё не собран — красная полоса на карточке. */
function isUrgent(o: WorkOrder, today: string, nowMinutes: number): boolean {
  if (!["new", "confirmed", "assembling"].includes(o.status)) return false;
  if (o.date < today) return true;
  if (o.date !== today || !o.timeFrom) return false;
  const [h, m] = o.timeFrom.split(":").map(Number);
  return h * 60 + m - nowMinutes <= 120;
}

function useStudioNow() {
  const [now, setNow] = useState<{ today: string; minutes: number } | null>(null);
  useEffect(() => {
    const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" });
    const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Simferopol" });
    const tick = () => {
      const d = new Date();
      const [h, m] = timeFmt.format(d).split(":").map(Number);
      setNow({ today: dayFmt.format(d), minutes: h * 60 + m });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function OrderCard({ o, urgent, overdue, onOpen }: { o: WorkOrder; urgent: boolean; overdue: boolean; onOpen: () => void }) {
  const items = o.items.map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name)).join(", ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative w-full overflow-hidden rounded-2xl bg-white p-3.5 text-left ring-1 ring-inset ring-zinc-200 transition hover:ring-lavender-300 ${
        urgent ? "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-red-500" : ""
      }`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[15px] font-semibold tabular-nums">{timeLabel(o)}</span>
        <span className="text-sm font-semibold tabular-nums">{formatMoney(o.total)}</span>
      </span>
      <span className="mt-1 block truncate text-sm text-zinc-700">{o.isPickup ? "Самовывоз" : o.address ?? "адрес не указан"}</span>
      {items && <span className="mt-0.5 block truncate text-sm text-zinc-500">{items}</span>}
      <span className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
        <span
          className={`rounded-full px-2 py-0.5 ${
            o.paid ? "bg-emerald-50 text-emerald-800" : o.paidAmount > 0 ? "bg-amber-100 text-amber-900" : "bg-red-50 text-red-700"
          }`}
        >
          {o.paid ? "оплачено" : o.paidAmount > 0 ? `внесено ${formatMoney(o.paidAmount)}` : "не оплачено"}
        </span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">{STATUS_LABEL[o.status]}</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-500">{o.source === "site" ? "с сайта" : "магазин"}</span>
        {overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">просрочен</span>}
        {o.photos.length > 0 && <span className="rounded-full bg-lavender-50 px-2 py-0.5 text-lavender-700">фото {o.photosSentAt ? "отправлено" : "есть"}</span>}
      </span>
    </button>
  );
}

type Props = {
  work: WorkOrder[];
  awaitingPayment: WorkOrder[];
  doneToday: WorkOrder[];
  methods: PaymentMethodOption[];
  shiftOpen: boolean;
};

export function OrdersBoard({ work, awaitingPayment, doneToday, methods, shiftOpen }: Props) {
  const now = useStudioNow();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showUnpaid, setShowUnpaid] = useState(false);
  const [kind, setKind] = useState<"all" | "delivery" | "pickup">("all");
  const fits = (o: WorkOrder) => kind === "all" || (kind === "pickup" ? o.isPickup : !o.isPickup);

  const today = now?.today ?? "";
  const tomorrow = today ? new Date(new Date(`${today}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10) : "";
  const byTime = (a: WorkOrder, b: WorkOrder) => (a.date + (a.timeFrom ?? "00:00")).localeCompare(b.date + (b.timeFrom ?? "00:00"));

  const columns = [
    { key: "overdue", title: "Просрочены", list: work.filter((o) => fits(o) && today && o.date < today) },
    { key: "today", title: "Сегодня", list: work.filter((o) => fits(o) && o.date === today) },
    { key: "tomorrow", title: "Завтра", list: work.filter((o) => fits(o) && o.date === tomorrow) },
    { key: "later", title: "Позже", list: work.filter((o) => fits(o) && tomorrow && o.date > tomorrow) },
  ].filter((c) => c.key !== "overdue" || c.list.length > 0);

  const all = [...work, ...awaitingPayment, ...doneToday];
  const open = openId ? all.find((o) => o.id === openId) ?? null : null;

  return (
    <div className={ui.page}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Какие заказы">
          {(
            [
              ["all", `Все · ${work.length}`],
              ["delivery", `Доставка · ${work.filter((o) => !o.isPickup).length}`],
              ["pickup", `Самовывоз · ${work.filter((o) => o.isPickup).length}`],
            ] as ["all" | "delivery" | "pickup", string][]
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`${ui.chip} ${kind === k ? ui.chipOn : ui.chipOff}`}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setCreating(true)} className={`${ui.btnPrimary} min-h-[48px]`}>
          + Заказ
        </button>
      </div>
      {!now ? null : (
        <div className={`grid gap-4 ${columns.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"} md:grid-cols-2`}>
          {columns.map((c) => (
            <section key={c.key}>
              <h2 className={`${ui.label} mb-2 flex justify-between ${c.key === "overdue" ? "text-red-700" : ""}`}>
                <span>{c.title}</span>
                <span className="tabular-nums">{c.list.length}</span>
              </h2>
              <div className="space-y-2">
                {c.list.sort(byTime).map((o) => (
                  <OrderCard key={o.id} o={o} urgent={isUrgent(o, today, now.minutes)} overdue={c.key === "overdue"} onOpen={() => setOpenId(o.id)} />
                ))}
                {c.list.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-400">Заказов нет</p>}
              </div>
            </section>
          ))}
        </div>
      )}

      {doneToday.length > 0 && (
        <section className="mt-8">
          <h2 className={`${ui.label} mb-2`}>Выполнены сегодня · {doneToday.length}</h2>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            {doneToday.map((o) => (
              <OrderCard key={o.id} o={o} urgent={false} overdue={false} onOpen={() => setOpenId(o.id)} />
            ))}
          </div>
        </section>
      )}

      {awaitingPayment.length > 0 && (
        <section className="mt-8">
          <button type="button" onClick={() => setShowUnpaid((v) => !v)} className={`${ui.label} flex items-center gap-2`}>
            Ждут оплаты · {awaitingPayment.length} <span aria-hidden="true">{showUnpaid ? "▴" : "▾"}</span>
          </button>
          <p className="mt-1 text-sm text-zinc-500">Оформлены на сайте, но не оплачены. Собирать не нужно, пока не придёт оплата.</p>
          {showUnpaid && (
            <div className="mt-3 grid gap-2 opacity-70 md:grid-cols-2 lg:grid-cols-4">
              {awaitingPayment.sort(byTime).map((o) => (
                <OrderCard key={o.id} o={o} urgent={false} overdue={false} onOpen={() => setOpenId(o.id)} />
              ))}
            </div>
          )}
        </section>
      )}

      {open &&
        (open.source === "shop" ? (
          <ShopOrderPanel order={open} methods={methods} shiftOpen={shiftOpen} onClose={() => setOpenId(null)} />
        ) : (
          <OrderPanel order={open} onClose={() => setOpenId(null)} />
        ))}
      {creating && <ShopOrderForm order={null} methods={methods} shiftOpen={shiftOpen} onClose={() => setCreating(false)} />}
    </div>
  );
}

export function OrderPanel({ order: o, onClose }: { order: WorkOrder; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmNoPhoto, setConfirmNoPhoto] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const step = nextStep(o);
  const path = o.isPickup ? PATH_PICKUP : PATH_DELIVERY;
  const at = path.indexOf(o.status);

  async function go(to: OrderStatus) {
    setBusy(true);
    setError(null);
    const result = await updateOrderStatus(o.id, to);
    if (result.success && to === "confirmed" && !o.floristAcceptedAt) await setOrderFloristAccepted(o.id, true);
    setBusy(false);
    setConfirmNoPhoto(false);
    setConfirmCancel(false);
    if (!result.success) return setError(result.error);
    toast({ tone: "ok", text: `${o.number}: ${STATUS_LABEL[to as WorkOrder["status"]].toLowerCase()}` });
    if (to === "completed" || to === "cancelled") onClose();
    router.refresh();
  }

  function advance() {
    if (!step) return;
    // «Собран» — момент, когда клиент должен увидеть букет. Без фото можно,
    // но только осознанно, вторым нажатием.
    if (step.to === "ready" && o.photos.length === 0 && !confirmNoPhoto) return setConfirmNoPhoto(true);
    go(step.to);
  }

  return (
    <Panel label={`Заказ ${o.number}`} onClose={onClose}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold">
            {o.number} · {timeLabel(o)}
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {new Date(`${o.date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" })} ·{" "}
            {o.isPickup ? "самовывоз" : "доставка"} · {STATUS_LABEL[o.status].toLowerCase()}
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      <div className="space-y-5 p-5">
        <p className={`rounded-xl px-4 py-3 text-base font-bold ${o.paid ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
          {o.paid ? `Оплачено ${formatMoney(o.total)} — деньги не брать` : `Не оплачено · ${formatMoney(o.total)}`}
        </p>

        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-zinc-500">Получатель</dt>
          <dd>
            {o.recipientName} ·{" "}
            <a href={`tel:${o.recipientPhone}`} className="font-semibold text-lavender-700 underline underline-offset-2">
              {o.recipientPhone}
            </a>
          </dd>
          {!o.isRecipientSelf && (
            <>
              <dt className="text-zinc-500">Заказчик</dt>
              <dd>
                {o.customerName} ·{" "}
                <a href={`tel:${o.customerPhone}`} className="font-semibold text-lavender-700 underline underline-offset-2">
                  {o.customerPhone}
                </a>
              </dd>
            </>
          )}
          {!o.isPickup && (
            <>
              <dt className="text-zinc-500">Куда</dt>
              <dd>
                {o.address ?? "не указано"}
                {o.addressExtra && <span className="block text-zinc-500">{o.addressExtra}</span>}
              </dd>
            </>
          )}
          <dt className="text-zinc-500">Состав</dt>
          <dd>
            {o.items.length ? (
              <ul>
                {o.items.map((i, n) => (
                  <li key={n}>
                    {i.name}
                    {i.qty > 1 && <span className="text-zinc-500"> × {i.qty}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              "—"
            )}
          </dd>
          {o.cardText && (
            <>
              <dt className="text-zinc-500">Открытка</dt>
              <dd className="italic">«{o.cardText}»</dd>
            </>
          )}
          {o.courierComment && (
            <>
              <dt className="text-zinc-500">Курьеру</dt>
              <dd>{o.courierComment}</dd>
            </>
          )}
          {o.adminComment && (
            <>
              <dt className="text-zinc-500">Заметка</dt>
              <dd>{o.adminComment}</dd>
            </>
          )}
        </dl>

        <ol className="space-y-1.5" aria-label="Путь заказа">
          {path.map((s, i) => (
            <li
              key={s}
              className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold ${
                i <= at ? "bg-emerald-50 text-emerald-800" : i === at + 1 ? "bg-lavender-50 text-lavender-800" : "bg-zinc-50 text-zinc-400"
              }`}
            >
              <span>{s === "completed" && o.isPickup ? "Выдан" : STATUS_LABEL[s]}</span>
              <span aria-hidden="true">{i <= at ? "✓" : i === at + 1 ? "→" : ""}</span>
            </li>
          ))}
        </ol>

        {step && (
          <div>
            {confirmNoPhoto && (
              <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Фото нет — клиент не увидит букет до доставки. Добавьте фото ниже или отметьте «Собран» без него.
              </p>
            )}
            <button type="button" disabled={busy} onClick={advance} className={`${ui.btnPrimary} min-h-[52px] w-full text-base`}>
              {busy ? "Сохраняем…" : confirmNoPhoto ? "Да, собран без фото" : step.label}
            </button>
          </div>
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        <div className="border-t border-zinc-100 pt-4">
          <AssembledPhoto orderId={o.id} photoUrls={o.photos} sentAt={o.photosSentAt} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-4 text-sm">
          <Link href={`/admin/orders/${o.id}`} className="text-zinc-500 underline underline-offset-2 hover:text-zinc-800">
            Открыть в админке сайта
          </Link>
          {o.status !== "completed" &&
            (confirmCancel ? (
              <span className="flex items-center gap-2">
                <span className="text-red-700">{o.paid ? "Отменить? Деньги вернуть отдельно, в кабинете ВТБ" : "Отменить заказ?"}</span>
                <button type="button" disabled={busy} onClick={() => go("cancelled")} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white">
                  Да
                </button>
                <button type="button" onClick={() => setConfirmCancel(false)} className="rounded-lg px-3 py-1.5 text-zinc-600 hover:bg-zinc-100">
                  Нет
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmCancel(true)} className="font-medium text-red-600 hover:text-red-700">
                Отменить заказ
              </button>
            ))}
        </div>
      </div>
    </Panel>
  );
}
