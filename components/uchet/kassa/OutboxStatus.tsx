"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { recordSale } from "@/lib/uchet/pos-actions";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { CloseButton, Panel } from "@/components/uchet/Overlay";
import { SERVER_FAILURE, classifyFailure, readOutbox, removePending, setPendingError, useOutbox, type Pending } from "./outbox";

const RETRY_MS = 20_000;
const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Simferopol" });

// Одна отправка за раз на всю страницу: значок может смонтироваться
// дважды (разные раскладки), а чек не должен уходить параллельно сам с собой.
let flushing: Promise<void> | null = null;

/**
 * Значок в шапке учёта: «N продаж ждут отправки». Пока такие есть,
 * досылает их сам — при открытии, при появлении связи и раз в 20 секунд.
 * Продажа, которую сервер отклонил по делу (смена закрыта, букет уже
 * продан), сама не повторяется: её видно в панели с причиной.
 */
export function OutboxStatus() {
  const router = useRouter();
  const toast = useToast();
  const pending = useOutbox();
  const [stale, setStale] = useState(false);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);

  const flush = useCallback(async () => {
    if (flushing) return flushing;
    const run = (async () => {
      const queue = readOutbox().filter((p) => !p.error);
      if (!queue.length) return;
      setSending(true);
      let sent = 0;
      for (const p of queue) {
        try {
          const r = await recordSale(p.input);
          if (r.success) {
            removePending(p.id);
            sent += 1;
          } else {
            setPendingError(p.id, r.error);
          }
        } catch (e) {
          const why = classifyFailure(e);
          if (why === "stale") setStale(true);
          // Ответил ошибкой сам сервер — эта продажа ждёт «Повторить»,
          // иначе с истёкшим входом она бы молча висела «в очереди».
          if (why === "server") setPendingError(p.id, SERVER_FAILURE);
          break; // остальные — в следующий раз
        }
      }
      if (mounted.current) setSending(false);
      if (sent) {
        toast({ tone: "ok", text: sent === 1 ? "Продажа без связи отправлена" : `Отправлено продаж без связи: ${sent}` });
        router.refresh();
      }
    })();
    flushing = run.finally(() => {
      flushing = null;
    });
    return flushing;
  }, [router, toast]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const waiting = pending.filter((p) => !p.error).length;
  const failed = pending.length - waiting;

  useEffect(() => {
    if (!waiting) return;
    flush();
    const onOnline = () => flush();
    window.addEventListener("online", onOnline);
    const id = window.setInterval(() => flush(), RETRY_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(id);
    };
  }, [waiting, flush]);

  if (!pending.length && !stale) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-full px-3 py-1 text-xs font-semibold ${failed || stale ? "bg-red-50 text-red-800" : "bg-amber-100 text-amber-900"}`}
        title="Продажи, сохранённые на айпаде без связи"
      >
        {stale ? "Обновите страницу" : failed ? `Не прошло: ${failed}` : sending ? "Отправляем…" : `Ждут отправки: ${waiting}`}
      </button>
      {open && <OutboxPanel pending={pending} stale={stale} sending={sending} onRetry={flush} onClose={() => setOpen(false)} />}
    </>
  );
}

function OutboxPanel({ pending, stale, sending, onRetry, onClose }: { pending: Pending[]; stale: boolean; sending: boolean; onRetry: () => void; onClose: () => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);

  return (
    <Panel label="Продажи без связи" onClose={onClose}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold">Продажи без связи</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Сохранены на этом айпаде. Пока они здесь, не очищайте браузер и не закрывайте смену.</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="space-y-3 p-5">
        {stale && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-900">
            <p className="font-semibold">Вышла новая версия учёта.</p>
            <p className="mt-1">Обновите страницу — продажи не потеряются и уйдут сами.</p>
            <button type="button" onClick={() => window.location.reload()} className={`${ui.btnPrimary} mt-3 w-full`}>
              Обновить страницу
            </button>
          </div>
        )}
        {pending.length === 0 && <p className={ui.muted}>Всё отправлено.</p>}
        <ul className="space-y-2">
          {pending.map((p) => (
            <li key={p.id} className={`rounded-xl p-4 ring-1 ring-inset ${p.error ? "bg-red-50 ring-red-200" : "ring-zinc-200"}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold tabular-nums">{formatMoney(p.amount)}</span>
                <span className="text-sm text-zinc-500">в {timeFmt.format(new Date(p.savedAt))}</span>
              </div>
              <p className="text-sm text-zinc-600">Позиций в чеке: {p.input.lines.length}</p>
              {p.error ? (
                <>
                  <p className="mt-1 text-sm text-red-800">Не прошло: {p.error}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPendingError(p.id, null);
                        onRetry();
                      }}
                      className={`${ui.btnSecondary} min-h-[38px] px-4`}
                    >
                      Повторить
                    </button>
                    {confirm === p.id ? (
                      <button type="button" onClick={() => removePending(p.id)} className={`${ui.btnDanger} min-h-[38px] px-4`}>
                        Да, убрать — проведу заново
                      </button>
                    ) : (
                      <button type="button" onClick={() => setConfirm(p.id)} className={`${ui.btnGhost} min-h-[38px]`}>
                        Убрать
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-amber-800">Ждёт связи</p>
              )}
            </li>
          ))}
        </ul>
        {pending.some((p) => !p.error) && (
          <button type="button" disabled={sending} onClick={onRetry} className={`${ui.btnPrimary} w-full`}>
            {sending ? "Отправляем…" : "Отправить сейчас"}
          </button>
        )}
      </div>
    </Panel>
  );
}
