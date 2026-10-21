import Link from "next/link";
import type { CashOut, Money, ShiftRow } from "@/lib/uchet/money";
import { formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shift = (m: string, d: number) => {
  const total = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + d;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
};
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Simferopol" });
const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
const fmtTime = (iso: string | null) => (iso ? timeFmt.format(new Date(iso)) : "");
const signed = (n: number) => `${n > 0 ? "+" : "−"}${formatMoney(Math.abs(n))}`;

const KIND_LABEL: Record<string, string> = { purchase: "закупка", salary: "зарплата", collection: "инкассация", refund: "возврат клиенту", other: "" };

/**
 * Деньги за месяц. Сверху — то, ради чего раздел: расхождения в кассе.
 * Открыли не с тем, что оставили вчера, или насчитали при закрытии не
 * столько, сколько должно быть, — такие смены выделены и посчитаны.
 */
export function MoneyView({ money }: { money: Money }) {
  const issues = money.shifts.filter((s) => s.variance || s.openingDiff);
  // Итог — одной суммой со знаком, а не «излишки» и «недостачи» порознь:
  // опечатка при открытии (10 ₽ вместо 10 000) даёт пару «−9 990 при
  // открытии, +9 150 при закрытии», и порознь она раздула бы обе цифры.
  const net = money.shifts.reduce((s, x) => s + (x.variance ?? 0) + (x.openingDiff ?? 0), 0);
  const received = money.methods.reduce((s, m) => s + m.amount, 0) + money.site.amount;

  return (
    <div className={`${ui.page} max-w-5xl space-y-5`}>
      <section className={ui.cardPad}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className={ui.h1}>Деньги · {monthLabel(money.month)}</h1>
            <p className={`${ui.muted} mt-1`}>
              {money.isCurrent ? `Месяц идёт — по ${Number(money.to.slice(8, 10))} число` : "Месяц закрыт"}
              {money.posifloraPart && " · смены и оплаты — из Posiflora (только чтение)"}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/uchet/dengi?m=${shift(money.month, -1)}`} className={ui.btnSecondary}>
              ‹ {MONTHS[Number(shift(money.month, -1).slice(5, 7)) - 1]}
            </Link>
            {!money.isCurrent && (
              <Link href={`/uchet/dengi?m=${shift(money.month, 1)}`} className={ui.btnSecondary}>
                {MONTHS[Number(shift(money.month, 1).slice(5, 7)) - 1]} ›
              </Link>
            )}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Поступило" value={formatMoney(Math.round(received))} />
          <Tile label="Смен" value={String(money.shifts.length)} />
          <Tile label="С расхождением" value={String(issues.length)} tone={issues.length ? "warn" : undefined} />
          <Tile label="Итог расхождений" value={net ? signed(net) : "0 ₽"} tone={net < 0 ? "bad" : net > 0 ? "warn" : undefined} />
        </div>
      </section>

      {money.errors.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
          <p className="font-semibold">Часть цифр не загрузилась — это не нули.</p>
          <ul className="mt-1 list-disc pl-5">
            {money.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className="mt-1">Обновите страницу через минуту.</p>
        </section>
      )}

      <section className={ui.cardPad}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className={ui.h2}>Кассовые смены</h2>
          <span className="text-sm text-zinc-500">{issues.length ? `с расхождением: ${issues.length}` : "расхождений нет"}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          «При открытии» — в кассе не то, что оставили в прошлый раз. «При закрытии» — насчитали не столько, сколько должно быть по чекам и
          движениям наличных. Плюс — денег больше, минус — меньше.
        </p>
        {money.shifts.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">Смен за месяц нет.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {money.shifts.map((s, i) => (
              <ShiftLine key={`${s.source}${s.openedAt}${i}`} s={s} />
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={ui.cardPad}>
          <h2 className={ui.h2}>Поступления по способам</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {money.methods.map((m) => (
              <li key={m.title} className="flex items-baseline justify-between gap-3">
                <span className="text-zinc-800">
                  {m.title}
                  {m.note && <span className="text-xs text-amber-800"> · {m.note}</span>}
                </span>
                <span className="tabular-nums text-zinc-900">{formatMoney(Math.round(m.amount))}</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-3">
              <span className="text-zinc-800">
                Сайт, онлайн ({money.site.count})
                {money.site.test && money.site.count > 0 && <span className="text-xs text-amber-800"> · ВТБ в тестовом режиме — денег нет</span>}
              </span>
              <span className="tabular-nums text-zinc-900">{formatMoney(Math.round(money.site.amount))}</span>
            </li>
            <li className="flex items-baseline justify-between gap-3 border-t border-zinc-100 pt-2 font-semibold">
              <span>Всего</span>
              <span className="tabular-nums">{formatMoney(Math.round(received))}</span>
            </li>
          </ul>
        </section>

        <section className={ui.cardPad}>
          <h2 className={ui.h2}>Наличные: внесено и выдано</h2>
          {money.posifloraPart && (
            <p className="mt-1 text-sm text-zinc-500">
              {money.posifloraPart.from === money.from && money.posifloraPart.to === money.to
                ? "Выдачи из кассы Posiflora её API не отдаёт — они появятся здесь после перехода на Учёт."
                : "До перехода на Учёт выдачи из кассы Posiflora не видны — ниже только Учёт."}
            </p>
          )}
          <CashList title="Выдано" list={money.cashOut} />
          <CashList title="Внесено" list={money.cashIn} />
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <div className={`rounded-xl px-3 py-3 sm:px-4 ${tone === "bad" ? "bg-red-50" : tone === "warn" ? "bg-amber-50" : "bg-zinc-50"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 whitespace-nowrap font-display text-lg font-bold tabular-nums sm:text-xl ${tone === "bad" ? "text-red-800" : tone === "warn" ? "text-amber-900" : "text-zinc-900"}`}>
        {value}
      </p>
    </div>
  );
}

function Diff({ label, value }: { label: string; value: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${value < 0 ? "bg-red-50 text-red-800" : "bg-amber-100 text-amber-900"}`}>
      {label}: {signed(value)} · {value < 0 ? "недостача" : "излишек"}
    </span>
  );
}

function ShiftLine({ s }: { s: ShiftRow }) {
  const people = [s.openedBy && `открытие: ${s.openedBy}`, s.closedBy && `закрытие: ${s.closedBy}`].filter(Boolean).join(" · ");
  return (
    <li className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 ${s.variance || s.openingDiff ? "" : "text-zinc-700"}`}>
      <div className="min-w-[160px] flex-1">
        <p className="font-medium text-zinc-900">
          {fmtDay(s.day)} · {fmtTime(s.openedAt)}
          {s.closedAt ? `–${fmtTime(s.closedAt)}` : " · идёт"}
        </p>
        {people && <p className="text-xs text-zinc-500">{people}</p>}
        {(s.openingDiff || s.variance) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {s.openingDiff ? <Diff label="при открытии" value={s.openingDiff} /> : null}
            {s.variance ? <Diff label="при закрытии" value={s.variance} /> : null}
          </div>
        )}
      </div>
      <div className="flex gap-4 text-right text-sm tabular-nums">
        <Num label="открыли с" value={s.opening} />
        <Num label="должно быть" value={s.expected} />
        <Num label="насчитали" value={s.counted} />
      </div>
    </li>
  );
}

function Num({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="block min-w-[70px]">
      <span className="block whitespace-nowrap text-zinc-900">{value === null ? "—" : formatMoney(value)}</span>
      <span className="block text-xs text-zinc-400">{label}</span>
    </span>
  );
}

function CashList({ title, list }: { title: string; list: CashOut[] }) {
  const total = list.reduce((s, x) => s + x.amount, 0);
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={ui.label}>{title}</h3>
        {total > 0 && <span className="text-sm font-semibold tabular-nums">{formatMoney(Math.round(total))}</span>}
      </div>
      {list.length === 0 ? (
        <p className="mt-1 text-sm text-zinc-500">Ничего.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {list.map((x) => (
            <li key={x.title} className="flex items-baseline justify-between gap-3">
              <span className="text-zinc-800">
                {x.title}
                <span className="text-xs text-zinc-500">
                  {" "}
                  · {x.count}
                  {KIND_LABEL[x.kind] ? ` · ${KIND_LABEL[x.kind]}` : ""}
                </span>
              </span>
              <span className="tabular-nums text-zinc-900">{formatMoney(Math.round(x.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
