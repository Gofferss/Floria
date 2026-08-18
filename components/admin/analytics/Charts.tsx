"use client";

import { useState } from "react";
import type { DailyBreakdown, ProductStat, RankedItem } from "@/lib/actions/analytics";

// ================================================================
// Палитра — валидированный набор из скилла dataviz (references/palette.md),
// прогнан через scripts/validate_palette.js для 4 соседних слотов:
// все проверки PASS (CVD ΔE 9.1 светлая / 8.4 тёмная, ≥8 порог). Тёмную
// тему не делаем — вся остальная админка светлая, добавлять её только
// для одной страницы было бы непоследовательно.
// ================================================================
const SERIES = [
  { key: "product_view" as const, label: "Просмотры", color: "#2a78d6" },
  { key: "add_to_cart" as const, label: "В корзину", color: "#eb6834" },
  { key: "button_click" as const, label: "Клики по кнопкам", color: "#1baf7a" },
  { key: "story_open" as const, label: "Открытия сторис", color: "#eda100" },
];

const BAR_HUE = "#2a78d6";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const dayLabelFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric" });

function formatCompact(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5">
      <span className="block font-body text-xs text-ink/50">{label}</span>
      <span className="mt-1 block font-display text-3xl font-semibold text-ink">{formatCompact(value)}</span>
    </div>
  );
}

const PLOT_HEIGHT = 180;

export function DailyTrendChart({ daily }: { daily: DailyBreakdown[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const maxTotal = Math.max(
    5,
    ...daily.map((d) => d.product_view + d.add_to_cart + d.button_click + d.story_open)
  );
  const niceMax = Math.ceil(maxTotal / 5) * 5;

  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-ink">Активность за 14 дней</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 font-body text-xs text-ink/60">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative mt-6 flex" style={{ height: PLOT_HEIGHT + 44 }}>
        {/* Ось Y — три хэрлайн-отметки */}
        <div className="flex w-8 shrink-0 flex-col justify-between pb-6 text-right" style={{ height: PLOT_HEIGHT }}>
          {[niceMax, Math.round(niceMax / 2), 0].map((tick) => (
            <span key={tick} className="font-body text-[10px] text-ink/40">
              {tick}
            </span>
          ))}
        </div>

        <div className="relative flex flex-1 items-end gap-1">
          {/* Гридлайны */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: PLOT_HEIGHT }}>
            <div className="border-t border-lavender-100" />
            <div className="border-t border-lavender-100" />
            <div className="border-t border-lavender-200" />
          </div>

          {daily.map((day, index) => {
            const total = day.product_view + day.add_to_cart + day.button_click + day.story_open;
            let cumBelow = 0;

            return (
              <div
                key={day.date}
                className="relative flex flex-1 flex-col items-center"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered((h) => (h === index ? null : h))}
              >
                <div className="relative w-full max-w-[22px]" style={{ height: PLOT_HEIGHT }}>
                  <div className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[3px]" style={{ height: PLOT_HEIGHT }}>
                    {SERIES.map((s) => {
                      const value = day[s.key];
                      const heightPx = (value / niceMax) * PLOT_HEIGHT;
                      const bottom = (cumBelow / niceMax) * PLOT_HEIGHT;
                      cumBelow += value;
                      if (value === 0) return null;
                      return (
                        <div
                          key={s.key}
                          className="absolute inset-x-0"
                          style={{
                            bottom,
                            height: Math.max(0, heightPx - 2),
                            backgroundColor: s.color,
                          }}
                        />
                      );
                    })}
                  </div>
                  {hovered === index && (
                    <div
                      className="absolute bottom-full left-1/2 z-10 mb-2 w-40 -translate-x-1/2 rounded-xl border border-lavender-100 bg-white p-3 shadow-lg"
                      role="tooltip"
                    >
                      <p className="font-display text-xs font-semibold text-ink">{dateFormatter.format(new Date(day.date))}</p>
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {SERIES.map((s) => (
                          <li key={s.key} className="flex items-center justify-between gap-3 font-body text-xs text-ink/70">
                            <span className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                              {s.label}
                            </span>
                            <span className="font-semibold text-ink">{day[s.key]}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1.5 border-t border-lavender-100 pt-1.5 font-body text-xs font-semibold text-ink">
                        Всего: {total}
                      </p>
                    </div>
                  )}
                </div>
                <span className="mt-1.5 font-body text-[10px] text-ink/40">{dayLabelFormatter.format(new Date(day.date))}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function RankedBarList({ title, items, emptyHint }: { title: string; items: RankedItem[]; emptyHint: string }) {
  const maxCount = Math.max(1, ...items.map((i) => i.count));

  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
      <h2 className="font-display text-base font-semibold text-ink">{title}</h2>

      {items.length === 0 ? (
        <p className="mt-4 font-body text-sm text-ink/50">{emptyHint}</p>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate font-body text-xs text-ink/70 sm:w-36" title={item.label}>
                {item.label}
              </span>
              <div className="relative h-5 flex-1 rounded-full bg-lavender-50">
                <div
                  className="h-5 rounded-full"
                  style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: BAR_HUE }}
                />
              </div>
              <span className="w-8 shrink-0 text-right font-body text-xs font-semibold text-ink">{item.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProductStatsTable({ stats }: { stats: ProductStat[] }) {
  if (stats.length === 0) {
    return (
      <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
        <h2 className="font-display text-base font-semibold text-ink">Букеты: просмотры и добавления в корзину</h2>
        <p className="mt-4 font-body text-sm text-ink/50">Пока нет данных за последние 30 дней.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-lavender-100 bg-white">
      <div className="p-5 sm:p-7 sm:pb-0">
        <h2 className="font-display text-base font-semibold text-ink">Букеты: просмотры и добавления в корзину</h2>
        <p className="mt-1 font-body text-xs text-ink/50">За последние 30 дней, по убыванию просмотров</p>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left">
          <thead>
            <tr className="border-b border-lavender-100 bg-lavender-50/60">
              <th className="px-5 py-3 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">Букет</th>
              <th className="px-5 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                Просмотры
              </th>
              <th className="px-5 py-3 text-right font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                В корзину
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.map((row) => (
              <tr key={row.label} className="border-b border-lavender-50 last:border-0">
                <td className="px-5 py-3 font-body text-sm text-ink">{row.label}</td>
                <td className="px-5 py-3 text-right font-body text-sm text-ink/70">{row.views}</td>
                <td className="px-5 py-3 text-right font-body text-sm text-ink/70">{row.addToCart}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
