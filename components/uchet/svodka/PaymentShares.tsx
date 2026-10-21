"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceBlock } from "@/lib/uchet/summary";
import { savePosifloraPaymentName } from "@/lib/uchet/summary-actions";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";

const SUGGEST = ["Наличные", "Карта", "СБП", "Перевод", "Сертификат", "Бонусы"];

/**
 * Как платили. У Posiflora способы приходят без названий — их API этого не
 * отдаёт, — поэтому у безымянного способа кнопка «Подписать»: владелец один
 * раз сверяет суммы с отчётом по оплатам в самой Posiflora.
 */
export function PaymentShares({ payments, canName }: { payments: SourceBlock["payments"]; canName: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const unnamed = canName && payments.some((p) => !p.title);

  return (
    <section className={ui.cardPad}>
      <h2 className={ui.h2}>Как платили</h2>
      {payments.length === 0 ? (
        <p className={`${ui.muted} mt-3`}>Оплат за период нет.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {payments.map((p, i) => (
            <li key={p.id}>
              {editing === p.id ? (
                <NameForm id={p.id} initial={p.title ?? ""} onDone={() => setEditing(null)} />
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium text-zinc-900">
                      {p.title ?? <span className="text-zinc-500">Способ {i + 1}</span>}
                      {canName && (
                        <button type="button" onClick={() => setEditing(p.id)} className="ml-2 text-xs font-semibold text-lavender-700 underline underline-offset-2">
                          {p.title ? "изменить" : "подписать"}
                        </button>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-zinc-800">
                      {formatMoney(p.amount)} <span className="text-zinc-500">· {p.share.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-zinc-100">
                    <div className="h-2 rounded-full bg-lavender-600" style={{ width: `${Math.max(1, Math.min(100, p.share))}%` }} />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {unnamed && (
        <p className="mt-4 text-xs leading-relaxed text-zinc-500">
          Posiflora не отдаёт названия способов оплаты. Откройте в Posiflora отчёт по оплатам за этот же период и подпишите способы по суммам — один раз, дальше подписи сохранятся.
        </p>
      )}
    </section>
  );
}

function NameForm({ id, initial, onDone }: { id: string; initial: string; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save(value: string) {
    setBusy(true);
    const result = await savePosifloraPaymentName(id, value);
    setBusy(false);
    if (!result.success) return toast({ tone: "error", text: result.error });
    onDone();
    router.refresh();
  }

  return (
    <div className="rounded-xl bg-zinc-50 p-3">
      <div className="flex flex-wrap gap-1.5">
        {SUGGEST.map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => save(s)} className={`${ui.chip} ${ui.chipOff} min-h-[32px] text-xs`}>
            {s}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" maxLength={40} className={ui.fieldSm} />
        <button type="button" disabled={busy} onClick={() => save(title)} className={`${ui.btnPrimary} min-h-[38px] px-4`}>
          {busy ? "…" : "OK"}
        </button>
        <button type="button" onClick={onDone} className={`${ui.btnGhost} min-h-[38px]`}>
          Отмена
        </button>
      </div>
    </div>
  );
}
