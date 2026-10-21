// ================================================================
// Визуальный язык приложения учёта.
//
// Это рабочий инструмент, а не витрина: нейтральный светлый фон, белые
// карточки, контраст выше, чем на сайте, крупные касания. Фирменные цвета
// — тёмный сливовый рельс и фиолетовые основные кнопки — оставляют
// ощущение «это Флория», не превращая склад в открытку.
//
// Классы собраны здесь, чтобы все экраны выглядели одинаково и чтобы
// поменять вид можно было в одном месте.
// ================================================================

import type { GroupKind } from "@/lib/uchet/format";

export const ui = {
  page: "mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8",
  card: "rounded-2xl border border-zinc-200 bg-white",
  cardPad: "rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6",
  h1: "font-display text-xl font-bold text-zinc-900 sm:text-2xl",
  h2: "font-display text-base font-semibold text-zinc-900",
  label: "text-xs font-semibold uppercase tracking-wide text-zinc-500",
  muted: "text-sm text-zinc-500",
  num: "tabular-nums",

  field:
    "w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-[15px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-lavender-500 focus:ring-2 focus:ring-lavender-500/20",
  fieldSm:
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-lavender-500 focus:ring-2 focus:ring-lavender-500/20",

  btnPrimary:
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-lavender-600 px-5 text-sm font-semibold text-white transition hover:bg-lavender-700 disabled:cursor-not-allowed disabled:opacity-40",
  btnSecondary:
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-800 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40",
  btnDanger:
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-40",
  btnGhost:
    "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900",

  chip: "inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition",
  chipOn: "bg-zinc-900 text-white",
  chipOff: "bg-white text-zinc-700 ring-1 ring-inset ring-zinc-200 hover:ring-zinc-300",

  th: "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500",
  td: "px-3 py-2.5 text-sm text-zinc-800",
};

/**
 * Цвет группы — по ВИДУ, а не случайный. У Posiflora цвет папки
 * назначается как придётся, и «ИМПОРТ» чёрным рядом с «Уценкой» жёлтым
 * не говорит ни о чём. Здесь розовое — всегда цветы, зелёное — всегда
 * зелень, и глаз находит нужное раньше, чем прочитает подпись.
 */
export const KIND_STYLE: Record<GroupKind, { tile: string; dot: string }> = {
  flower: { tile: "bg-rose-50 ring-rose-200 text-rose-950", dot: "bg-rose-400" },
  greenery: { tile: "bg-emerald-50 ring-emerald-200 text-emerald-950", dot: "bg-emerald-500" },
  decor: { tile: "bg-amber-50 ring-amber-200 text-amber-950", dot: "bg-amber-400" },
  packaging: { tile: "bg-slate-50 ring-slate-200 text-slate-900", dot: "bg-slate-400" },
  gift: { tile: "bg-sky-50 ring-sky-200 text-sky-950", dot: "bg-sky-400" },
  print: { tile: "bg-violet-50 ring-violet-200 text-violet-950", dot: "bg-violet-400" },
  service: { tile: "bg-zinc-50 ring-zinc-200 text-zinc-800", dot: "bg-zinc-400" },
  bouquet: { tile: "bg-yellow-50 ring-yellow-200 text-yellow-950", dot: "bg-yellow-400" },
  other: { tile: "bg-stone-50 ring-stone-200 text-stone-900", dot: "bg-stone-400" },
};
