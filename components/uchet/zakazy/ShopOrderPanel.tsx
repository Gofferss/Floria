"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { recordSale } from "@/lib/uchet/pos-actions";
import { cancelShopOrder, setShopOrderStatus } from "@/lib/uchet/shop-order-actions";
import type { PaymentMethodOption } from "@/lib/uchet/pos-queries";
import type { WorkOrder } from "@/lib/uchet/order-queries";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { CloseButton, Dialog, Panel } from "@/components/uchet/Overlay";
import { PaySheet } from "@/components/uchet/kassa/PaySheet";
import { AmountDialog } from "@/components/uchet/kassa/KassaDialogs";
import { ShopOrderForm } from "@/components/uchet/zakazy/ShopOrderForm";

const STATUS_LABEL: Record<string, string> = {
  new: "Новый",
  assembling: "Собирается",
  ready: "Собран",
  delivering: "У курьера",
  completed: "Выдан",
  cancelled: "Отменён",
};

const CHANNEL_LABEL: Record<string, string> = { shop: "в зале", phone: "по телефону", messenger: "из мессенджера", other: "" };

function timeLabel(o: WorkOrder): string {
  if (o.timeFrom && o.timeTo) return `${o.timeFrom}–${o.timeTo}`;
  if (o.timeFrom) return `к ${o.timeFrom}`;
  return "в течение дня";
}

type Props = {
  order: WorkOrder;
  methods: PaymentMethodOption[];
  shiftOpen: boolean;
  onClose: () => void;
};

/**
 * Заказ магазина. Главное наверху — сколько внесено и сколько осталось.
 * Букет к заказу собирается в кассе (цветы спишутся со склада), а если
 * собирали «по цене», без состава, — отметкой «Собран без состава».
 */
export function ShopOrderPanel({ order: o, methods, shiftOpen, onClose }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<null | "amount" | "pay" | "edit" | "cancel">(null);
  const [payAmount, setPayAmount] = useState(0);
  const [saleId, setSaleId] = useState(() => crypto.randomUUID());
  const [refund, setRefund] = useState<"cash" | "other" | "keep" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDebt, setConfirmDebt] = useState(false);

  const rest = Math.max(0, Math.round((o.total - o.paidAmount) * 100) / 100);
  const path = o.isPickup ? ["new", "assembling", "ready", "completed"] : ["new", "assembling", "ready", "delivering", "completed"];
  const at = path.indexOf(o.status);
  const closed = o.status === "completed" || o.status === "cancelled";
  // Выданный заказ с недоплатой — это долг: оплату по нему принимать можно.
  const canPay = rest > 0 && o.status !== "cancelled";
  const debt = rest > 0 && o.status === "completed";
  const assembleHref = `/uchet/kassa?mode=assembly&order=${o.id}`;

  async function step(to: "assembling" | "ready" | "delivering" | "completed") {
    if (to === "completed" && rest > 0 && !confirmDebt) return setConfirmDebt(true);
    setBusy(true);
    setError(null);
    const r = await setShopOrderStatus(o.id, to);
    setBusy(false);
    setConfirmDebt(false);
    if (!r.success) return setError(r.error);
    toast({ tone: "ok", text: `${o.number}: ${STATUS_LABEL[to].toLowerCase()}` });
    if (to === "completed") onClose();
    router.refresh();
  }

  async function pay(payments: { method: string; amount: number }[]) {
    setBusy(true);
    setError(null);
    const r = await recordSale({
      id: saleId,
      customerId: null,
      discountPercent: 0,
      approval: null,
      comment: null,
      lines: [{ kind: "order", orderId: o.id, amount: payAmount }],
      payments,
    });
    setBusy(false);
    if (!r.success) return setError(r.error);
    toast({ tone: "ok", text: `${o.number}: внесено ${formatMoney(payAmount)} — ${r.data.saleNo}` });
    setSaleId(crypto.randomUUID());
    setMode(null);
    router.refresh();
  }

  async function cancel() {
    if (o.paidAmount > 0 && !refund) return setError("Выберите, что сделать с предоплатой");
    setBusy(true);
    setError(null);
    const r = await cancelShopOrder(o.id, o.paidAmount > 0 ? refund : null, reason);
    setBusy(false);
    if (!r.success) return setError(r.error);
    toast({
      tone: "ok",
      text:
        `${o.number} отменён` +
        (r.data.refunded ? `, возврат ${formatMoney(r.data.refunded)}` : "") +
        (r.data.toVitrine ? `, букет — на витрине` : ""),
    });
    onClose();
    router.refresh();
  }

  // Следующий шаг одной кнопкой; сборка — в кассе, чтобы списать состав.
  const actions: React.ReactNode[] = [];
  if (o.status === "new" || o.status === "assembling") {
    actions.push(
      <Link key="asm" href={assembleHref} className={`${ui.btnPrimary} min-h-[52px] w-full text-base`}>
        Собрать букет к заказу
      </Link>
    );
    actions.push(
      <button key="noc" type="button" disabled={busy} onClick={() => step("ready")} className={`${ui.btnSecondary} w-full`}>
        Собран без состава
      </button>
    );
  } else if (o.status === "ready") {
    actions.push(
      <button key="go" type="button" disabled={busy} onClick={() => step(o.isPickup ? "completed" : "delivering")} className={`${ui.btnPrimary} min-h-[52px] w-full text-base`}>
        {confirmDebt ? `Выдать, хотя не внесено ${formatMoney(rest)}` : o.isPickup ? "Выдан клиенту" : "Передан курьеру"}
      </button>
    );
    actions.push(
      <Link key="more" href={assembleHref} className={`${ui.btnSecondary} w-full`}>
        Собрать ещё букет к заказу
      </Link>
    );
  } else if (o.status === "delivering") {
    actions.push(
      <button key="done" type="button" disabled={busy} onClick={() => step("completed")} className={`${ui.btnPrimary} min-h-[52px] w-full text-base`}>
        {confirmDebt ? `Доставлен, хотя не внесено ${formatMoney(rest)}` : "Доставлен"}
      </button>
    );
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
            {o.isPickup ? "самовывоз" : "доставка"} · заказ {CHANNEL_LABEL[o.channel] ?? ""}
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      <div className="space-y-5 p-5">
        <div className={`rounded-xl px-4 py-3 ${rest === 0 ? "bg-emerald-50 text-emerald-900" : o.paidAmount > 0 ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-900"}`}>
          <p className="text-base font-bold">
            {rest === 0 ? `Оплачено ${formatMoney(o.total)}` : o.paidAmount > 0 ? `Внесено ${formatMoney(o.paidAmount)} из ${formatMoney(o.total)}` : `Не оплачено · ${formatMoney(o.total)}`}
          </p>
          {rest > 0 && o.status !== "cancelled" && <p className="text-sm">{debt ? `Долг ${formatMoney(rest)} — заказ уже выдан` : `Осталось ${formatMoney(rest)}`}</p>}
          {o.status === "cancelled" && <p className="text-sm">Заказ отменён{o.cancelReason ? `: ${o.cancelReason}` : ""}</p>}
          {canPay && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("amount");
              }}
              disabled={!shiftOpen}
              className={`${ui.btnPrimary} mt-3 w-full`}
            >
              Принять оплату
            </button>
          )}
          {canPay && !shiftOpen && <p className="mt-2 text-xs">Чтобы принять оплату, откройте смену.</p>}
        </div>

        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-zinc-500">Получатель</dt>
          <dd>
            {o.recipientName}
            {o.recipientPhone && (
              <>
                {" · "}
                <a href={`tel:${o.recipientPhone}`} className="font-semibold text-lavender-700 underline underline-offset-2">
                  {o.recipientPhone}
                </a>
              </>
            )}
          </dd>
          {!o.isRecipientSelf && o.customerPhone && (
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
                {o.address}
                {o.addressExtra && <span className="block text-zinc-500">{o.addressExtra}</span>}
              </dd>
            </>
          )}
          {o.wishes && (
            <>
              <dt className="text-zinc-500">Что собрать</dt>
              <dd>{o.wishes}</dd>
            </>
          )}
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
          {o.items.length > 0 && (
            <>
              <dt className="text-zinc-500">Собрано</dt>
              <dd>{o.items.map((i) => i.name).join(", ")}</dd>
            </>
          )}
        </dl>

        {o.photos.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {o.photos.map((u) => (
              <span key={u} className="relative aspect-square overflow-hidden rounded-xl bg-zinc-100">
                <Image src={u} alt="" fill sizes="100px" className="object-cover" />
              </span>
            ))}
          </div>
        )}

        {o.status !== "cancelled" && (
          <ol className="space-y-1.5" aria-label="Путь заказа">
            {path.map((s, i) => (
              <li
                key={s}
                className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold ${
                  i <= at ? "bg-emerald-50 text-emerald-800" : i === at + 1 ? "bg-lavender-50 text-lavender-800" : "bg-zinc-50 text-zinc-400"
                }`}
              >
                <span>{s === "completed" && !o.isPickup ? "Доставлен" : STATUS_LABEL[s]}</span>
                <span aria-hidden="true">{i <= at ? "✓" : i === at + 1 ? "→" : ""}</span>
              </li>
            ))}
          </ol>
        )}

        {confirmDebt && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Остаток {formatMoney(rest)} не внесён. Примите оплату выше — или отдайте в долг вторым нажатием.</p>}
        {!closed && <div className="grid gap-2">{actions}</div>}
        {error && !mode && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        {!closed && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-4 text-sm">
            <button type="button" onClick={() => setMode("edit")} className="font-medium text-lavender-700 hover:text-lavender-800">
              Изменить заказ
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("cancel");
              }}
              className="font-medium text-red-600 hover:text-red-700"
            >
              Отменить заказ
            </button>
          </div>
        )}
      </div>

      {mode === "amount" && (
        <AmountDialog
          title="Сколько вносят"
          hint={`Осталось ${formatMoney(rest)}. Можно часть.`}
          initial={rest}
          confirm="Дальше — способ оплаты"
          onClose={() => setMode(null)}
          onDone={(v) => {
            if (v > rest) return toast({ tone: "error", text: `Больше остатка: осталось ${formatMoney(rest)}` });
            setPayAmount(v);
            setMode("pay");
          }}
        />
      )}
      {mode === "pay" && <PaySheet amount={payAmount} methods={methods} busy={busy} error={error} onPay={pay} onClose={() => setMode(null)} />}
      {mode === "edit" && <ShopOrderForm order={o} methods={methods} shiftOpen={shiftOpen} onClose={() => setMode(null)} />}
      {mode === "cancel" && (
        <Dialog label="Отменить заказ" onClose={() => setMode(null)}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-lg font-semibold">Отменить {o.number}?</h3>
            <CloseButton onClose={() => setMode(null)} />
          </div>
          {o.paidAmount > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-zinc-600">Внесено {formatMoney(o.paidAmount)}. Что с ними?</p>
              {(
                [
                  ["cash", "Вернуть наличными из кассы", "Запишется изъятием в смене"],
                  ["other", "Вернули картой или переводом", "Мимо кассы, наличные не трогаем"],
                  ["keep", "Оставить у студии", "Клиент отказался сам — предоплата остаётся выручкой"],
                ] as ["cash" | "other" | "keep", string, string][]
              ).map(([k, label, hint]) => (
                <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-inset ${refund === k ? "bg-lavender-50 ring-lavender-400" : "ring-zinc-200"}`}>
                  <input type="radio" name="refund" checked={refund === k} onChange={() => setRefund(k)} className="mt-1 h-4 w-4 accent-lavender-600" />
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="block text-xs text-zinc-500">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина, если знаете" aria-label="Причина отмены" className={`${ui.field} mt-3`} />
          {o.items.length > 0 && <p className="mt-2 text-xs text-zinc-500">Собранный букет переедет на витрину — его можно будет продать.</p>}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode(null)} className={ui.btnSecondary}>
              Не отменять
            </button>
            <button type="button" disabled={busy} onClick={cancel} className={ui.btnDanger}>
              {busy ? "…" : "Отменить заказ"}
            </button>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
