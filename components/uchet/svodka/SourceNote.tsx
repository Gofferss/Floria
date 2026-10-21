"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setSummaryUchetSince } from "@/lib/uchet/summary-actions";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { fmtDay } from "./fmt";

/**
 * Откуда цифры и переключатель на Учёт. Одна дата, а не «сложить обе
 * кассы»: в месяц параллельной работы продажи бьются в обеих, и сумма
 * посчитала бы их дважды.
 */
export function SourceNote({ since, canSwitch, today }: { since: string | null; canSwitch: boolean; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(since ?? today);
  const [busy, setBusy] = useState(false);

  async function save(value: string | null) {
    setBusy(true);
    const result = await setSummaryUchetSince(value);
    setBusy(false);
    if (!result.success) return toast({ tone: "error", text: result.error });
    toast({ tone: "ok", text: value ? `С ${fmtDay(value)} сводка считает по Учёту` : "Сводка снова считает по Posiflora" });
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="text-sm leading-relaxed text-zinc-500">
      <p>
        {since ? (
          <>
            Выручка до {fmtDay(since)} — из Posiflora, с {fmtDay(since)} — из Учёта.
          </>
        ) : (
          <>Выручка, чеки, оплаты, сотрудники и списания — из Posiflora (только чтение), заказы сайта — из базы сайта.</>
        )}{" "}
        Прибыль в Posiflora — ориентир: закупка там шла изъятием из кассы, а не приходом, поэтому себестоимость неточная.
      </p>
      {canSwitch ? (
        open ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span>Считать по Учёту с</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={`${ui.fieldSm} w-auto`} />
            <button type="button" disabled={busy || !day} onClick={() => save(day)} className={`${ui.btnPrimary} min-h-[38px] px-4`}>
              Сохранить
            </button>
            {since && (
              <button type="button" disabled={busy} onClick={() => save(null)} className={`${ui.btnSecondary} min-h-[38px] px-4`}>
                Вернуть Posiflora
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className={`${ui.btnGhost} min-h-[38px]`}>
              Отмена
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="mt-1 font-semibold text-lavender-700 underline underline-offset-2">
            {since ? "Изменить дату перехода" : "Перейти на данные Учёта"}
          </button>
        )
      ) : (
        <p className="mt-1">Когда учёт будет запущен, здесь можно будет переключить сводку на его данные.</p>
      )}
    </div>
  );
}
