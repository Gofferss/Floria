"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Period } from "@/lib/uchet/summary";
import { ui } from "@/components/uchet/ui";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/** Последние полтора года, от свежего месяца к старому: «Сентябрь 2026». */
function recentMonths(today: string, count = 18): { value: string; label: string }[] {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ value: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTHS[m - 1]} ${y}` });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** Период сводки: готовые кнопки и любой месяц из списка. */
export function PeriodBar({ period, chips, today }: { period: Period; chips: { key: string; href: string; label: string }[]; today: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <Link key={c.key} href={c.href} className={`${ui.chip} ${period.key === c.key ? ui.chipOn : ui.chipOff}`}>
          {c.label}
        </Link>
      ))}
      <select
        aria-label="Другой месяц"
        value={period.key === "m" && period.month ? period.month : ""}
        onChange={(e) => e.target.value && router.push(`/uchet/svodka?m=${e.target.value}`)}
        className={`${ui.chip} ${period.key === "m" ? ui.chipOn : ui.chipOff} cursor-pointer appearance-none pr-3.5 outline-none`}
      >
        <option value="">Другой месяц…</option>
        {recentMonths(today).map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
