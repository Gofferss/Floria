"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markOrderPaid } from "@/lib/actions/orders";

const LABEL = { sbp: "переводом или по СБП", cash: "наличными" } as const;

/**
 * «Оплату получили» для заказа с сайта, оплаченного не через сайт. Два шага:
 * выбрать способ и подтвердить сумму — отметку видит курьер, и ошибочная
 * «оплачено» значит, что деньги не возьмут. Используется в админке и в учёте.
 */
export function MarkOrderPaid({ orderId, total }: { orderId: string; total: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ask, setAsk] = useState<"cash" | "sbp" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sum = `${Math.round(total).toLocaleString("ru-RU")} ₽`;

  function confirm() {
    if (!ask) return;
    setError(null);
    startTransition(async () => {
      const result = await markOrderPaid(orderId, ask);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setAsk(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {ask ? (
        <div className="rounded-2xl border border-leaf-200 bg-leaf-50 p-3">
          <p className="text-sm text-zinc-800">
            Получили <b>{sum}</b> {LABEL[ask]}? Курьер увидит «оплачено» и деньги брать не будет.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-leaf-700 disabled:opacity-60"
            >
              {pending ? "Отмечаем…" : "Да, получили"}
            </button>
            <button
              type="button"
              onClick={() => setAsk(null)}
              disabled={pending}
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Назад
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAsk("sbp")}
            className="rounded-full border border-leaf-200 bg-white px-4 py-2 text-sm font-semibold text-leaf-700 transition hover:bg-leaf-50"
          >
            Оплачено переводом / СБП
          </button>
          <button
            type="button"
            onClick={() => setAsk("cash")}
            className="rounded-full border border-leaf-200 bg-white px-4 py-2 text-sm font-semibold text-leaf-700 transition hover:bg-leaf-50"
          >
            Оплачено наличными
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
