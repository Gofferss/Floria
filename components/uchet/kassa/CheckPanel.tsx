"use client";

import Image from "next/image";
import Link from "next/link";
import { formatMoney, formatQty } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import {
  bouquetPrice,
  compositionPrice,
  discountAmount,
  due,
  isEmpty,
  subtotal,
  unpricedStems,
  type Check,
  type ItemIndex,
} from "@/components/uchet/kassa/check";

type Props = {
  assembly: boolean;
  check: Check;
  index: ItemIndex;
  activeKey: string | null;
  parked: Check[];
  shiftOpen: boolean;
  onActivate: (key: string) => void;
  onStem: (bouquetKey: string, itemId: string, delta: number) => void;
  onBouquetPrice: (bouquetKey: string) => void;
  onRemoveBouquet: (bouquetKey: string) => void;
  onRemoveVitrine: (key: string) => void;
  onItemQty: (itemId: string, delta: number) => void;
  onItemPrice: (itemId: string) => void;
  onNewBouquet: () => void;
  onCustomer: () => void;
  onDiscount: () => void;
  onPark: () => void;
  onUnpark: (i: number) => void;
  onPay: () => void;
  onToVitrine: () => void;
  onCancelAssembly: () => void;
  forOrder?: { number: string; wishes: string | null } | null;
};

function Stepper({ value, onMinus, onPlus, label }: { value: number; onMinus: () => void; onPlus: () => void; label: string }) {
  return (
    <span className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" onClick={onMinus} className="h-8 w-8 rounded-lg bg-zinc-100 text-base font-bold text-zinc-700 active:bg-zinc-200" aria-label="Меньше">
        −
      </button>
      <span className="min-w-[2rem] text-center text-sm font-semibold tabular-nums">{formatQty(value)}</span>
      <button type="button" onClick={onPlus} className="h-8 w-8 rounded-lg bg-zinc-100 text-base font-bold text-zinc-700 active:bg-zinc-200" aria-label="Больше">
        +
      </button>
    </span>
  );
}

/**
 * Чек. «+ Новый букет» — в самом чеке, на виду: это главное действие
 * флориста (у Posiflora — маленький кружок в углу). Цена букета видна сразу —
 * по составу или своя, касанием по цене.
 */
export function CheckPanel(p: Props) {
  const { check, index, assembly } = p;
  const sum = subtotal(check, index);
  const disc = discountAmount(check, index);
  const toPay = due(check, index);
  const empty = isEmpty(check);

  return (
    <aside className="flex min-h-0 flex-col border-t border-zinc-200 bg-white md:border-l md:border-t-0" aria-label="Чек">
      <div className="space-y-2 border-b border-zinc-100 p-3">
        {p.parked.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto" aria-label="Отложенные чеки">
            {p.parked.map((c, i) => (
              <button key={c.id} type="button" onClick={() => p.onUnpark(i)} className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                Отложен · {formatMoney(due(c, index))}
              </button>
            ))}
          </div>
        )}
        {assembly ? (
          p.forOrder ? (
            <p className="text-sm text-zinc-600">
              Собираете букет к заказу <span className="font-semibold text-zinc-900">{p.forOrder.number}</span>: цветы спишутся со склада сразу.
              {p.forOrder.wishes && <span className="mt-1 block rounded-lg bg-lavender-50 px-2.5 py-1.5 text-zinc-800">«{p.forOrder.wishes}»</span>}
            </p>
          ) : (
            <p className="text-sm text-zinc-600">Собираете букет на витрину: цветы спишутся со склада сразу, при продаже — уже ничего.</p>
          )
        ) : (
          <button
            type="button"
            onClick={p.onCustomer}
            className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition ${
              check.customer ? "bg-lavender-50 text-zinc-900 ring-1 ring-inset ring-lavender-200" : "border border-dashed border-zinc-300 text-zinc-500 hover:border-zinc-400"
            }`}
          >
            {check.customer ? (
              <>
                <span className="font-semibold">{check.customer.name || check.customer.phone}</span>
                <span className="text-zinc-500"> · бонусов {formatMoney(check.customer.bonusBalance)}</span>
              </>
            ) : (
              "+ Клиент — по желанию"
            )}
          </button>
        )}
      </div>

      <div className="min-h-[200px] flex-1 space-y-2 overflow-y-auto p-3">
        {empty && (
          <p className="px-4 py-10 text-center text-sm leading-relaxed text-zinc-400">
            {assembly ? (
              <>
                Касайтесь цветов слева —<br />они лягут в букет для витрины.
              </>
            ) : (
              <>
                Чек пуст.
                <br />
                Касание по цветку слева — и он в букете.
                <br />
                Готовый букет — плитка «Витрина».
              </>
            )}
          </p>
        )}

        {check.vitrine.map((v) => (
          <div key={v.key} className="flex items-center gap-3 rounded-xl p-2 ring-1 ring-inset ring-zinc-200">
            <span className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
              {v.photo && <Image src={v.photo} alt="" fill sizes="40px" className="object-cover" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{v.title}</span>
              <span className="block text-xs text-zinc-500">с витрины · уже собран</span>
            </span>
            <span className="text-sm font-semibold tabular-nums">{formatMoney(v.price)}</span>
            <button type="button" onClick={() => p.onRemoveVitrine(v.key)} className="h-8 w-8 rounded-lg bg-zinc-100 text-zinc-500" aria-label="Убрать из чека">
              ✕
            </button>
          </div>
        ))}

        {check.bouquets.map((b) => {
          const active = b.key === p.activeKey;
          const auto = compositionPrice(b, index);
          const unpriced = unpricedStems(b, index);
          return (
            <div
              key={b.key}
              className={`overflow-hidden rounded-xl ring-inset ${active ? "ring-2 ring-lavender-600" : "ring-1 ring-zinc-200"}`}
              onClick={() => p.onActivate(b.key)}
            >
              <div className="flex items-center justify-between gap-2 bg-zinc-50 px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{b.title}</span>
                  <span className="block text-[11px] text-zinc-500">
                    {b.stems.length === 0
                      ? "состав не указан"
                      : b.manualPrice !== null
                        ? `цена своя · по составу ${formatMoney(auto)}`
                        : "цена по составу"}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onBouquetPrice(b.key);
                    }}
                    className="rounded-lg px-2 py-1 text-[15px] font-semibold tabular-nums hover:bg-lavender-50"
                    title="Изменить цену"
                  >
                    {formatMoney(bouquetPrice(b, index))}
                  </button>
                  {!assembly && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        p.onRemoveBouquet(b.key);
                      }}
                      className="h-8 w-8 rounded-lg bg-white text-zinc-500 ring-1 ring-inset ring-zinc-200"
                      aria-label="Убрать букет"
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
              {b.stems.map((s) => (
                <div key={s.itemId} className="flex items-center justify-between gap-2 border-t border-zinc-100 px-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{index.get(s.itemId)?.title ?? "—"}</span>
                  <Stepper
                    label={index.get(s.itemId)?.title ?? "позиция"}
                    value={s.qty}
                    onMinus={() => p.onStem(b.key, s.itemId, -1)}
                    onPlus={() => p.onStem(b.key, s.itemId, 1)}
                  />
                </div>
              ))}
              {b.stems.length === 0 && !assembly && (
                <p className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Без состава цветы не спишутся со склада. Можно и так — состав можно добавить касаниями слева.
                </p>
              )}
              {unpriced > 0 && b.manualPrice === null && (
                <p className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  У {unpriced} {unpriced === 1 ? "позиции" : "позиций"} нет цены — цена по составу занижена. Поставьте цену букета вручную.
                </p>
              )}
            </div>
          );
        })}

        {check.items.map((i) => (
          <div key={i.itemId} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200">
            <span className="min-w-0 flex-1 truncate">{index.get(i.itemId)?.title ?? "—"}</span>
            <Stepper label={index.get(i.itemId)?.title ?? "позиция"} value={i.qty} onMinus={() => p.onItemQty(i.itemId, -1)} onPlus={() => p.onItemQty(i.itemId, 1)} />
            <button type="button" onClick={() => p.onItemPrice(i.itemId)} className="min-w-[4.5rem] rounded-lg px-1.5 py-1 text-right font-semibold tabular-nums hover:bg-lavender-50" title="Изменить цену">
              {formatMoney(i.price * i.qty)}
            </button>
          </div>
        ))}

        {(!assembly || check.bouquets.length === 0) && (
          <button type="button" onClick={p.onNewBouquet} className="w-full rounded-xl border border-dashed border-lavender-300 bg-lavender-50 py-3 text-sm font-semibold text-lavender-700">
            + Новый букет
          </button>
        )}
      </div>

      <div className="space-y-2 border-t border-zinc-200 p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
        {assembly ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className={ui.label}>Цена по составу</span>
              <span className="font-display text-2xl font-bold tabular-nums">{formatMoney(check.bouquets[0] ? bouquetPrice(check.bouquets[0], index) : 0)}</span>
            </div>
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <button type="button" onClick={p.onCancelAssembly} className={`${ui.btnSecondary} min-h-[52px]`}>
                Отмена
              </button>
              <button
                type="button"
                disabled={!check.bouquets[0]?.stems.length}
                onClick={p.onToVitrine}
                className={`${ui.btnPrimary} min-h-[52px] text-base`}
              >
                {p.forOrder ? "Собран — к заказу" : "На витрину"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between text-sm text-zinc-500">
              <span>Сумма</span>
              <span className="tabular-nums">{formatMoney(sum)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <button type="button" onClick={p.onDiscount} disabled={empty} className="font-semibold text-lavender-700 disabled:text-zinc-300">
                {check.discountPercent ? `Скидка ${check.discountPercent}%` : "Скидка"}
                {check.approvedBy && <span className="font-normal text-zinc-500"> · подтвердил(а) {check.approvedBy}</span>}
              </button>
              <span className="tabular-nums text-zinc-500">{disc ? `−${formatMoney(disc)}` : ""}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className={ui.label}>К оплате</span>
              <span className="font-display text-[28px] font-bold tabular-nums">{formatMoney(toPay)}</span>
            </div>
            {!p.shiftOpen && !empty && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                Смена не открыта.{" "}
                <Link href="/uchet/smena" className="font-semibold underline underline-offset-2">
                  Открыть смену
                </Link>
                {" "}— чек останется здесь.
              </p>
            )}
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <button type="button" onClick={p.onPark} disabled={empty} className={`${ui.btnSecondary} min-h-[52px]`}>
                Отложить
              </button>
              <button type="button" onClick={p.onPay} disabled={empty || !p.shiftOpen} className={`${ui.btnPrimary} min-h-[52px] text-base`}>
                Оплата
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
