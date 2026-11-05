"use client";

import {
  MONTH_SHORT,
  SEASON_PRESETS,
  isInSeason,
  normalizeSeasonMonths,
  returnsInPhrase,
} from "@/lib/season";

type ProductSeasonFieldProps = {
  /** Отмеченные месяцы; пусто — весь год. */
  months: number[];
  onChange: (months: number[]) => void;
};

const chipClass = (active: boolean) =>
  `rounded-full border px-3 py-1.5 font-body text-sm transition ${
    active ? "border-gold-500 bg-gold-500 text-white" : "border-lavender-200 bg-white text-ink/70 hover:border-gold-300"
  }`;

export function ProductSeasonField({ months, onChange }: ProductSeasonFieldProps) {
  const toggleMonth = (m: number) => onChange(months.includes(m) ? months.filter((x) => x !== m) : [...months, m]);

  // Повторное нажатие на сезон снимает его месяцы.
  const togglePreset = (preset: number[]) => {
    const all = preset.every((m) => months.includes(m));
    onChange(all ? months.filter((m) => !preset.includes(m)) : [...new Set([...months, ...preset])]);
  };

  const normalized = normalizeSeasonMonths(months);
  const visible = isInSeason(normalized);
  const returns = returnsInPhrase(normalized);

  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
      <h2 className="font-display text-base font-semibold text-ink">Сезон</h2>
      <p className="mt-1 font-body text-xs text-ink/50">
        В какие месяцы показывать букет. Вне их он сам пропадёт из каталога и с главной, а потом сам вернётся. Ничего не
        отмечено — букет виден весь год.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => onChange([])} aria-pressed={!normalized} className={chipClass(!normalized)}>
          Весь год
        </button>
        {SEASON_PRESETS.map((preset) => {
          const active = preset.months.every((m) => months.includes(m));
          return (
            <button key={preset.label} type="button" onClick={() => togglePreset(preset.months)} aria-pressed={active} className={chipClass(active)}>
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
        {MONTH_SHORT.map((label, index) => {
          const m = index + 1;
          const active = months.includes(m);
          return (
            <button key={label} type="button" onClick={() => toggleMonth(m)} aria-pressed={active} className={`${chipClass(active)} text-center`}>
              {label}
            </button>
          );
        })}
      </div>

      <p className={`mt-4 font-body text-sm ${visible ? "text-ink/60" : "font-medium text-gold-700"}`}>
        {visible
          ? normalized
            ? "Сейчас букет виден на сайте."
            : "Букет виден на сайте круглый год."
          : `Сейчас букет скрыт: не его сезон. Вернётся ${returns}.`}
      </p>
    </div>
  );
}
