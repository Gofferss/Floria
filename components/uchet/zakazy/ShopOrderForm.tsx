"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createShopOrder, updateShopOrder, type ShopOrderFields } from "@/lib/uchet/shop-order-actions";
import type { PaymentMethodOption } from "@/lib/uchet/pos-queries";
import type { WorkOrder } from "@/lib/uchet/order-queries";
import { formatMoney } from "@/lib/uchet/format";
import { formatRussianPhoneInput, toE164RussianPhone } from "@/lib/phone-mask";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { CloseButton, Panel } from "@/components/uchet/Overlay";
import { AddressInput } from "@/components/uchet/zakazy/AddressInput";

// ================================================================
// Заказ магазина: новый и правка. Порядок полей — как идёт разговор с
// клиентом: когда → куда → кому → что собрать → сколько → предоплата.
// Обязательно немногое: дата, сумма, телефон, адрес для доставки.
// ================================================================

const CHANNELS: { key: ShopOrderFields["channel"]; label: string }[] = [
  { key: "shop", label: "В зале" },
  { key: "phone", label: "По телефону" },
  { key: "messenger", label: "Мессенджер" },
];

const SLOTS: { label: string; from: string; to: string }[] = [
  { label: "в течение дня", from: "", to: "" },
  { label: "10–12", from: "10:00", to: "12:00" },
  { label: "12–14", from: "12:00", to: "14:00" },
  { label: "15–17", from: "15:00", to: "17:00" },
  { label: "18–20", from: "18:00", to: "20:00" },
];

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" });
const day = (offset: number) => dayFmt.format(new Date(Date.now() + offset * 86_400_000));

type Prepay = "none" | "full" | "part";

type Props = {
  order: WorkOrder | null;
  methods: PaymentMethodOption[];
  shiftOpen: boolean;
  onClose: () => void;
};

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className={ui.label}>
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function ShopOrderForm({ order, methods, shiftOpen, onClose }: Props) {
  const router = useRouter();
  const toast = useToast();
  const editing = !!order;

  const [channel, setChannel] = useState<ShopOrderFields["channel"]>((order?.channel as ShopOrderFields["channel"]) ?? "phone");
  const [date, setDate] = useState(order?.date ?? day(1));
  const [timeFrom, setTimeFrom] = useState(order?.timeFrom ?? "");
  const [timeTo, setTimeTo] = useState(order?.timeTo ?? "");
  const [isPickup, setIsPickup] = useState(order?.isPickup ?? false);
  const [address, setAddress] = useState(order?.address ?? "");
  const [details, setDetails] = useState(order?.addressExtra ?? "");
  const [customerName, setCustomerName] = useState(order?.customerName && order.customerName !== "—" ? order.customerName : "");
  const [customerPhone, setCustomerPhone] = useState(order?.customerPhone ? formatRussianPhoneInput(order.customerPhone) : "");
  const [self, setSelf] = useState(order ? order.isRecipientSelf : false);
  const [recipientName, setRecipientName] = useState(order && !order.isRecipientSelf ? order.recipientName : "");
  const [recipientPhone, setRecipientPhone] = useState(order && !order.isRecipientSelf ? formatRussianPhoneInput(order.recipientPhone) : "");
  const [wishes, setWishes] = useState(order?.wishes ?? "");
  const [card, setCard] = useState(order?.cardText ?? "");
  const [courier, setCourier] = useState(order?.courierComment ?? "");
  const [total, setTotal] = useState(order ? String(Math.round(order.total)) : "");
  const [prepay, setPrepay] = useState<Prepay>("none");
  const [part, setPart] = useState("");
  const [method, setMethod] = useState(methods[0]?.code ?? "cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ids] = useState(() => ({ order: crypto.randomUUID(), sale: crypto.randomUUID() }));

  const totalN = Number(total.replace(/\s/g, "") || "0");
  const prepayAmount = prepay === "full" ? totalN : prepay === "part" ? Number(part.replace(/\s/g, "") || "0") : 0;

  async function submit() {
    setError(null);
    const cPhone = customerPhone ? toE164RussianPhone(customerPhone) : null;
    const rPhone = !self && recipientPhone ? toE164RussianPhone(recipientPhone) : null;
    if (customerPhone && !cPhone) return setError("Телефон заказчика — 10 цифр после +7");
    if (!self && recipientPhone && !rPhone) return setError("Телефон получателя — 10 цифр после +7");
    if (!cPhone && !rPhone) return setError("Нужен хотя бы один телефон");
    if (!isPickup && !address.trim()) return setError("Укажите адрес или выберите самовывоз");
    if (!total || totalN <= 0) return setError("Укажите сумму заказа");
    if (prepay === "part" && (prepayAmount <= 0 || prepayAmount >= totalN)) return setError("Часть предоплаты — больше нуля и меньше суммы заказа");
    if (timeFrom && timeTo && timeTo <= timeFrom) return setError("Время «до» должно быть позже «с»");

    const fields: ShopOrderFields = {
      channel,
      customerName: customerName.trim(),
      customerPhone: cPhone ?? "",
      recipientName: self ? customerName.trim() : recipientName.trim(),
      recipientPhone: self ? cPhone ?? "" : rPhone ?? "",
      isPickup,
      deliveryAddress: address.trim(),
      deliveryDetails: details.trim(),
      deliveryDate: date,
      timeFrom,
      timeTo,
      cardText: card.trim(),
      wishes: wishes.trim(),
      courierComment: courier.trim(),
      total: totalN,
    };

    setBusy(true);
    if (editing && order) {
      const r = await updateShopOrder(order.id, fields);
      setBusy(false);
      if (!r.success) return setError(r.error);
      toast({ tone: "ok", text: `${order.number}: сохранено` });
    } else {
      const r = await createShopOrder({
        id: ids.order,
        fields,
        prepay: prepayAmount > 0 ? { saleId: ids.sale, payments: [{ method, amount: prepayAmount }] } : null,
      });
      setBusy(false);
      if (!r.success) return setError(r.error);
      toast({
        tone: "ok",
        text: r.data.saleNo
          ? `Заказ ${r.data.orderNo} оформлен, предоплата ${formatMoney(prepayAmount)} — ${r.data.saleNo}`
          : `Заказ ${r.data.orderNo} оформлен`,
      });
    }
    onClose();
    router.refresh();
  }

  const slotOn = (s: (typeof SLOTS)[number]) => s.from === timeFrom && s.to === timeTo;

  return (
    <Panel label={editing ? `Заказ ${order?.number}` : "Новый заказ"} onClose={busy ? undefined : onClose} dismissible={!busy}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold">{editing ? `Изменить ${order?.number}` : "Новый заказ"}</h2>
          {!editing && <p className="mt-0.5 text-sm text-zinc-500">Клиенту в бот по заказам магазина ничего не уходит.</p>}
        </div>
        {!busy && <CloseButton onClose={onClose} />}
      </div>

      <div className="space-y-5 p-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Откуда заказ">
          {CHANNELS.map((c) => (
            <button key={c.key} type="button" onClick={() => setChannel(c.key)} aria-pressed={channel === c.key} className={`${ui.chip} ${channel === c.key ? ui.chipOn : ui.chipOff}`}>
              {c.label}
            </button>
          ))}
        </div>

        <div>
          <p className={ui.label}>Когда</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {[
              ["Сегодня", day(0)],
              ["Завтра", day(1)],
              ["Послезавтра", day(2)],
            ].map(([label, d]) => (
              <button key={d} type="button" onClick={() => setDate(d)} aria-pressed={date === d} className={`${ui.chip} ${date === d ? ui.chipOn : ui.chipOff}`}>
                {label}
              </button>
            ))}
            <input id="order-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата" className={ui.fieldInline} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {SLOTS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  setTimeFrom(s.from);
                  setTimeTo(s.to);
                }}
                aria-pressed={slotOn(s)}
                className={`${ui.chip} ${slotOn(s) ? ui.chipOn : ui.chipOff}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm text-zinc-600">
            с <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} aria-label="Время с" className={`${ui.fieldInline} w-28`} />
            до <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} aria-label="Время до" className={`${ui.fieldInline} w-28`} />
          </div>
        </div>

        <div className="flex gap-2" role="group" aria-label="Как получат">
          <button type="button" onClick={() => setIsPickup(false)} aria-pressed={!isPickup} className={`${ui.chip} ${!isPickup ? ui.chipOn : ui.chipOff}`}>
            Доставка
          </button>
          <button type="button" onClick={() => setIsPickup(true)} aria-pressed={isPickup} className={`${ui.chip} ${isPickup ? ui.chipOn : ui.chipOff}`}>
            Самовывоз
          </button>
        </div>
        {!isPickup && (
          <>
            <Field id="order-address" label="Адрес">
              <AddressInput id="order-address" value={address} onChange={setAddress} />
            </Field>
            <Field id="order-details" label="Квартира, подъезд, домофон">
              <input id="order-details" value={details} onChange={(e) => setDetails(e.target.value)} className={ui.field} placeholder="кв. 12, подъезд 2, домофон 12К" />
            </Field>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="order-cname" label="Заказчик">
            <input id="order-cname" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={ui.field} placeholder="Имя" />
          </Field>
          <Field id="order-cphone" label="Его телефон">
            <input id="order-cphone" type="tel" inputMode="tel" value={customerPhone} onChange={(e) => setCustomerPhone(formatRussianPhoneInput(e.target.value))} className={ui.field} placeholder="+7 (978) …" />
          </Field>
        </div>
        <label htmlFor="order-self" className="flex items-center gap-2 text-sm text-zinc-700">
          <input id="order-self" type="checkbox" checked={self} onChange={(e) => setSelf(e.target.checked)} className="h-4 w-4 accent-lavender-600" />
          Получает сам заказчик
        </label>
        {!self && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="order-rname" label="Получатель">
              <input id="order-rname" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className={ui.field} placeholder="Имя" />
            </Field>
            <Field id="order-rphone" label="Телефон получателя">
              <input id="order-rphone" type="tel" inputMode="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(formatRussianPhoneInput(e.target.value))} className={ui.field} placeholder="+7 (978) …" />
            </Field>
          </div>
        )}

        <Field id="order-wishes" label="Что собрать">
          <textarea id="order-wishes" rows={2} value={wishes} onChange={(e) => setWishes(e.target.value)} className={ui.field} placeholder="В бюджет, нежные тона, без лилий" />
        </Field>
        <Field id="order-card" label="Открытка">
          <textarea id="order-card" rows={2} value={card} onChange={(e) => setCard(e.target.value)} className={ui.field} placeholder="Текст, если нужна" />
        </Field>
        {!isPickup && (
          <Field id="order-courier" label="Курьеру">
            <input id="order-courier" value={courier} onChange={(e) => setCourier(e.target.value)} className={ui.field} placeholder="Позвонить за 15 минут" />
          </Field>
        )}

        <Field id="order-total" label="Сумма заказа" hint={isPickup ? undefined : "Вместе с доставкой"}>
          <input
            id="order-total"
            inputMode="numeric"
            value={total}
            onChange={(e) => setTotal(e.target.value.replace(/[^\d]/g, ""))}
            className={`${ui.field} font-display text-xl font-bold tabular-nums`}
            placeholder="0"
          />
          {editing && order && order.paidAmount > 0 && <p className="mt-1 text-xs text-zinc-500">Уже внесено {formatMoney(order.paidAmount)} — меньше этой суммы не поставить.</p>}
        </Field>

        {!editing && (
          <div className="rounded-2xl bg-zinc-50 p-4">
            <p className={ui.label}>Предоплата</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Предоплата">
              {(
                [
                  ["none", "Без предоплаты"],
                  ["full", "Вся сумма"],
                  ["part", "Часть"],
                ] as [Prepay, string][]
              ).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setPrepay(k)} aria-pressed={prepay === k} className={`${ui.chip} ${prepay === k ? ui.chipOn : ui.chipOff}`}>
                  {label}
                </button>
              ))}
            </div>
            {prepay === "part" && (
              <input
                id="order-part"
                inputMode="numeric"
                value={part}
                onChange={(e) => setPart(e.target.value.replace(/[^\d]/g, ""))}
                aria-label="Сколько вносят"
                className={`${ui.field} mt-3 w-40 tabular-nums`}
                placeholder="Сколько"
              />
            )}
            {prepay !== "none" && (
              <>
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Способ">
                  {methods.map((m) => (
                    <button key={m.code} type="button" onClick={() => setMethod(m.code)} aria-pressed={method === m.code} className={`${ui.chip} ${method === m.code ? "bg-lavender-600 text-white" : ui.chipOff}`}>
                      {m.title}
                    </button>
                  ))}
                </div>
                {!shiftOpen && <p className="mt-3 text-sm text-red-700">Смена не открыта — предоплату не принять. Откройте смену или оформите без предоплаты.</p>}
                {prepayAmount > 0 && <p className="mt-3 text-sm text-zinc-600">Пробьётся чеком в смене: {formatMoney(prepayAmount)}</p>}
              </>
            )}
          </div>
        )}

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <button type="button" disabled={busy || (!editing && prepay !== "none" && !shiftOpen)} onClick={submit} className={`${ui.btnPrimary} min-h-[52px] w-full text-base`}>
          {busy ? "Сохраняем…" : editing ? "Сохранить" : "Оформить заказ"}
        </button>
      </div>
    </Panel>
  );
}
