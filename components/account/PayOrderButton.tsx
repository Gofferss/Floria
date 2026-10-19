"use client";

import { useState, useTransition } from "react";

/**
 * «Оплатить» для заказа, который ещё не оплачен.
 *
 * Зачем она нужна. Оплата обязательна, но дорога от корзины до банка не
 * всегда проходится с первого раза: человек закрыл вкладку, передумал на
 * платёжной странице, у него сел телефон. Без этой кнопки такой заказ
 * становится тупиком — он есть в базе, а заплатить по нему неоткуда, и
 * клиенту остаётся только звонить.
 *
 * Ссылку на оплату не храним в разметке: она живёт ограниченное время, и
 * выданная на прошлой неделе уже ничего не стоит. Поэтому запрашиваем её
 * в момент нажатия — сервер отдаст живую или создаст новую.
 */
export function PayOrderButton({ orderId }: { orderId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/payments/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        const result = await response.json().catch(() => null);

        if (response.ok && result?.paymentUrl) {
          window.location.href = result.paymentUrl as string;
          return;
        }

        // Заказ уже оплачен — не ошибка, а устаревшая страница: баланс мог
        // обновиться в другой вкладке или уведомление от банка дошло
        // только что. Перезагружаем, чтобы человек увидел настоящий статус.
        if (result?.alreadyPaid) {
          window.location.reload();
          return;
        }

        setError(result?.error ?? "Не получилось открыть оплату");
      } catch {
        setError("Нет связи с сервером. Проверьте интернет и попробуйте снова.");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-full bg-gold-500 px-5 py-2.5 font-display text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-gold-600 disabled:opacity-50"
      >
        {isPending ? "Открываю…" : "Оплатить"}
      </button>
      {error && <p className="font-body text-xs text-red-600 sm:text-right">{error}</p>}
    </div>
  );
}
