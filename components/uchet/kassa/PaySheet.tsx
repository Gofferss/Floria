"use client";

import { useState } from "react";
import type { PaymentMethodOption } from "@/lib/uchet/pos-queries";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { CloseButton, Sheet } from "@/components/uchet/Overlay";
import { NumPad } from "@/components/uchet/NumPad";

type Props = {
  amount: number;
  methods: PaymentMethodOption[];
  /** Бонусы клиента, если их можно списать: сколько есть и сколько можно на этот чек. */
  bonus: { balance: number; max: number } | null;
  busy: boolean;
  error: string | null;
  onPay: (payments: { method: string; amount: number }[], bonusUsed: number) => void;
  onClose: () => void;
};

/**
 * Оплата. Способ — крупной кнопкой. Наличные: «сколько дали» → сдача
 * крупно. Несколько способов сразу — «Разделить»: у каждого своя сумма,
 * остаток виден. Фискальный чек бьёт отдельная касса, как сейчас.
 */
export function PaySheet({ amount, methods, bonus, busy, error, onPay, onClose }: Props) {
  const [method, setMethod] = useState(methods[0]?.code ?? "cash");
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [given, setGiven] = useState("");
  const [bonusUsed, setBonusUsed] = useState(0);
  const [bonusCustom, setBonusCustom] = useState(false);

  // К оплате деньгами — после бонусов. Всё ниже считается от этой суммы.
  const toPay = Math.max(0, Math.round((amount - bonusUsed) * 100) / 100);

  const current = methods.find((m) => m.code === method);
  const givenN = Number(given || "0");

  const splitSum = Object.values(parts).reduce((s, v) => s + Number(v || "0"), 0);
  const rest = Math.round((toPay - splitSum) * 100) / 100;

  // Подсказки «сколько дали»: ровно, до 500, до 1000, 5000.
  const hints = [toPay, Math.ceil(toPay / 500) * 500, Math.ceil(toPay / 1000) * 1000, 5000, 10000]
    .filter((v, i, a) => v >= toPay && a.indexOf(v) === i)
    .slice(0, 4);

  function applyBonus(v: number) {
    setBonusUsed(Math.max(0, Math.min(Math.floor(v), bonus?.max ?? 0)));
    setGiven("");
    setParts({});
  }

  function submit() {
    if (split) {
      const payments = Object.entries(parts)
        .map(([m, v]) => ({ method: m, amount: Number(v || "0") }))
        .filter((p) => p.amount > 0);
      onPay(payments, bonusUsed);
    } else {
      onPay(toPay > 0 ? [{ method, amount: toPay }] : [], bonusUsed);
    }
  }

  return (
    <Sheet label="Оплата" onClose={busy ? undefined : onClose} dismissible={!busy}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tabular-nums">Оплата · {formatMoney(amount)}</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {bonusUsed > 0 ? `Бонусами ${formatMoney(bonusUsed)}, деньгами ${formatMoney(toPay)}.` : "Чек покупателю пробивается кассой, как сейчас. Здесь — учёт."}
          </p>
        </div>
        {!busy && <CloseButton onClose={onClose} />}
      </div>

      {bonus && bonus.max > 0 && (
        <div className="mt-4 rounded-2xl bg-lavender-50 p-4">
          <p className="text-sm text-zinc-700">
            У клиента бонусов: <b className="tabular-nums">{formatMoney(bonus.balance)}</b>. На этот чек можно {formatMoney(bonus.max)}.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setBonusCustom(false);
                applyBonus(0);
              }}
              aria-pressed={bonusUsed === 0}
              className={`${ui.chip} ${bonusUsed === 0 ? ui.chipOn : ui.chipOff}`}
            >
              Не списывать
            </button>
            <button
              type="button"
              onClick={() => {
                setBonusCustom(false);
                applyBonus(bonus.max);
              }}
              aria-pressed={!bonusCustom && bonusUsed === bonus.max}
              className={`${ui.chip} ${!bonusCustom && bonusUsed === bonus.max ? ui.chipOn : ui.chipOff}`}
            >
              Списать {formatMoney(bonus.max)}
            </button>
            <button type="button" onClick={() => setBonusCustom(true)} aria-pressed={bonusCustom} className={`${ui.chip} ${bonusCustom ? ui.chipOn : ui.chipOff}`}>
              Своя сумма
            </button>
            {bonusCustom && (
              <input
                inputMode="numeric"
                aria-label="Сколько бонусов списать"
                value={bonusUsed ? String(bonusUsed) : ""}
                onChange={(e) => applyBonus(Number(e.target.value.replace(/[^0-9]/g, "") || "0"))}
                className={`${ui.fieldInline} w-28`}
              />
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2" role="group" aria-label="Как платят">
        <button type="button" onClick={() => setSplit(false)} aria-pressed={!split} className={`${ui.chip} ${!split ? ui.chipOn : ui.chipOff}`}>
          Одним способом
        </button>
        <button
          type="button"
          onClick={() => {
            setSplit(true);
            setParts({});
            setEditing(methods[0]?.code ?? null);
          }}
          aria-pressed={split}
          className={`${ui.chip} ${split ? ui.chipOn : ui.chipOff}`}
        >
          Разделить
        </button>
      </div>

      {!split ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Способ оплаты">
            {methods.map((m) => (
              <button
                key={m.code}
                type="button"
                onClick={() => {
                  setMethod(m.code);
                  setGiven("");
                }}
                aria-pressed={method === m.code}
                className={`min-h-[60px] rounded-2xl text-base font-semibold transition ${method === m.code ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200"}`}
              >
                {m.title}
              </button>
            ))}
          </div>

          {current?.isCash && toPay > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-zinc-500">Сколько дали</p>
              <div className="flex flex-wrap gap-2">
                {hints.map((h) => (
                  <button key={h} type="button" onClick={() => setGiven(String(h))} aria-pressed={givenN === h} className={`${ui.chip} ${givenN === h ? ui.chipOn : ui.chipOff}`}>
                    {formatMoney(h)}
                  </button>
                ))}
              </div>
              {givenN > toPay && (
                <div className="mt-3 flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-3 text-emerald-900">
                  <span className="font-semibold">Сдача</span>
                  <span className="font-display text-2xl font-bold tabular-nums">{formatMoney(givenN - toPay)}</span>
                </div>
              )}
              {givenN > 0 && givenN < toPay && <p className="mt-2 text-sm text-red-700">Дали меньше, чем к оплате.</p>}
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            {methods.map((m) => (
              <button
                key={m.code}
                type="button"
                onClick={() => setEditing(m.code)}
                className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition ${
                  editing === m.code ? "bg-lavender-50 ring-2 ring-lavender-600" : "bg-zinc-100 hover:bg-zinc-200"
                }`}
              >
                <span className="font-semibold">{m.title}</span>
                <span className="tabular-nums">{parts[m.code] ? formatMoney(Number(parts[m.code])) : "—"}</span>
              </button>
            ))}
            <p className={`text-sm font-semibold ${rest === 0 ? "text-emerald-700" : rest > 0 ? "text-zinc-600" : "text-red-700"}`}>
              {rest === 0 ? "Сумма сходится" : rest > 0 ? `Осталось распределить ${formatMoney(rest)}` : `Лишние ${formatMoney(-rest)}`}
            </p>
            {editing && rest > 0 && (
              <button
                type="button"
                onClick={() => setParts((p) => ({ ...p, [editing]: String(Number(p[editing] || "0") + rest) }))}
                className="text-sm font-semibold text-lavender-700"
              >
                Остаток — сюда
              </button>
            )}
          </div>
          {editing && <NumPad value={parts[editing] ?? ""} onChange={(v) => setParts((p) => ({ ...p, [editing]: v }))} />}
        </div>
      )}

      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <button
        type="button"
        disabled={busy || (split && rest !== 0) || (!split && !!current?.isCash && givenN > 0 && givenN < toPay)}
        onClick={submit}
        className="mt-5 min-h-[56px] w-full rounded-2xl bg-emerald-600 text-lg font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
      >
        {busy ? "Проводим…" : `Оплачено ${formatMoney(toPay)}`}
      </button>
    </Sheet>
  );
}
