"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Payroll } from "@/lib/uchet/payroll";
import { addFromPosiflora } from "@/lib/uchet/payroll-actions";
import { describeScheme } from "@/lib/uchet/pay-parts";
import { POSITION_LABEL } from "@/lib/uchet/positions";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { PeopleTabs } from "./PeopleTabs";
import { PayPanel } from "./PayPanel";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shift = (m: string, d: number) => {
  const total = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + d;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
};

/**
 * Зарплата за месяц: у каждого — схема, дни, начислено, выдано и сколько
 * осталось выдать. Подробности, табель и правки — в панели справа.
 */
export function PayrollView({ payroll }: { payroll: Payroll }) {
  const router = useRouter();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = payroll.employees.find((e) => e.id === openId) ?? null;
  const visible = payroll.employees.filter((e) => e.isActive || e.accrued || e.paidTotal || e.balance);

  async function addPeople(ids: string[]) {
    setBusy(true);
    const result = await addFromPosiflora(ids);
    setBusy(false);
    if (!result.success) return toast({ tone: "error", text: result.error });
    toast({ tone: "ok", text: ids.length > 1 ? "Люди добавлены" : "Человек добавлен" });
    router.refresh();
  }

  return (
    <div className={`${ui.page} max-w-5xl space-y-5`}>
      <PeopleTabs active="pay" />

      <section className={ui.cardPad}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className={ui.h1}>Зарплата · {monthLabel(payroll.month)}</h1>
            <p className={`${ui.muted} mt-1`}>
              {payroll.isCurrent ? `Месяц идёт — посчитано по ${Number(payroll.to.slice(8, 10))} число` : "Месяц закрыт"}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/uchet/lyudi/zarplata?m=${shift(payroll.month, -1)}`} className={ui.btnSecondary} aria-label="Прошлый месяц">
              ‹ {MONTHS[Number(shift(payroll.month, -1).slice(5, 7)) - 1]}
            </Link>
            {!payroll.isCurrent && (
              <Link href={`/uchet/lyudi/zarplata?m=${shift(payroll.month, 1)}`} className={ui.btnSecondary} aria-label="Следующий месяц">
                {MONTHS[Number(shift(payroll.month, 1).slice(5, 7)) - 1]} ›
              </Link>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Total label="Начислено" value={payroll.totals.accrued} />
          <Total label="Выдано" value={payroll.totals.paid} />
          <Total label="Осталось выдать" value={payroll.totals.balance} strong />
        </div>
      </section>

      {payroll.posifloraError && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
          <p className="font-semibold">Posiflora не ответила — части от продаж и смен до запуска посчитаны без неё.</p>
          <p className="mt-1">Это не настоящие суммы. Обновите страницу через минуту. Ошибка: {payroll.posifloraError.slice(0, 200)}</p>
        </section>
      )}

      {payroll.unlinked.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
          <p className="font-semibold text-zinc-900">В Posiflora есть сотрудники, которых нет в Учёте</p>
          <p className="mt-1 text-sm text-zinc-700">
            Добавьте тех, кому считаете зарплату: до запуска их продажи и смены берутся из Posiflora. PIN для айпада зададите потом в «Людях».
            Людей без входа в Posiflora (кто получает «Зарплата Таня» из кассы) добавьте в «Людях» кнопкой «+ Человек».
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {payroll.unlinked.map((w) => (
              <button key={w.id} type="button" disabled={busy} onClick={() => addPeople([w.id])} className={`${ui.chip} ${ui.chipOff}`}>
                + {w.name}
              </button>
            ))}
            {payroll.unlinked.length > 1 && (
              <button type="button" disabled={busy} onClick={() => addPeople(payroll.unlinked.map((w) => w.id))} className={`${ui.chip} ${ui.chipOn}`}>
                Добавить всех
              </button>
            )}
          </div>
        </section>
      )}

      <section className={ui.card}>
        {visible.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">Пока никого. Добавьте людей — из Posiflora выше или в «Людях».</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {visible.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setOpenId(e.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left hover:bg-zinc-50">
                  <span className="min-w-[180px] flex-1">
                    <span className="block font-semibold text-zinc-900">
                      {e.fullName}
                      {!e.isActive && <span className="font-normal text-zinc-500"> · не работает</span>}
                    </span>
                    <span className={`block text-sm ${e.current.length ? "text-zinc-500" : "text-amber-800"}`}>
                      {POSITION_LABEL[e.position]} · {describeScheme(e.current)}
                    </span>
                  </span>
                  <span className="flex gap-5 text-right text-sm tabular-nums">
                    <Cell label="дней" value={String(e.workedDays)} />
                    <Cell label="начислено" value={formatMoney(e.accrued + e.adjustmentsTotal)} />
                    <Cell label="выдано" value={formatMoney(e.paidTotal)} />
                    <Cell label="осталось" value={formatMoney(e.balance)} strong />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm leading-relaxed text-zinc-500">
        До запуска учёта личные продажи, продажи точки и рабочие дни берутся из Posiflora (только чтение): рабочий день — тот, когда человек открыл
        или закрыл смену. Второго флориста в загруженный день Posiflora не знает — отметьте его в табеле. После запуска дни ставятся по входу с
        PIN. «Осталось выдать» копится: долг с прошлых месяцев плюс этот.
      </p>

      {open && <PayPanel e={open} payroll={payroll} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-3 sm:px-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 whitespace-nowrap font-display tabular-nums text-zinc-900 ${strong ? "text-lg font-bold sm:text-2xl" : "text-base font-semibold sm:text-xl"}`}>
        {formatMoney(Math.round(value))}
      </p>
    </div>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="block min-w-[64px]">
      <span className={`block whitespace-nowrap ${strong ? "font-semibold text-zinc-900" : "text-zinc-800"}`}>{value}</span>
      <span className="block text-xs text-zinc-400">{label}</span>
    </span>
  );
}
