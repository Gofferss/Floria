import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { getAnalyticsSummary } from "@/lib/actions/analytics";
import { StatTile, DailyTrendChart, RankedBarList, ProductStatsTable } from "@/components/admin/analytics/Charts";

export const metadata: Metadata = {
  title: "Метрики — Админка Floria",
};

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  await requireStaffUser();
  const summary = await getAnalyticsSummary();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Админка
        </span>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Метрики</h1>
        <p className="mt-2 max-w-2xl font-body text-sm text-ink/60">
          За последние 30 дней. Без куки и без слежения за конкретным посетителем — считаем только
          анонимные события (сколько раз нажали кнопку, сколько раз открыли букет), поэтому
          дополнительное согласие для этого не нужно.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Просмотров букетов" value={summary.totals.product_view} />
        <StatTile label="Добавлений в корзину" value={summary.totals.add_to_cart} />
        <StatTile label="Кликов по кнопкам" value={summary.totals.button_click} />
        <StatTile label="Открытий сторис" value={summary.totals.story_open} />
      </div>

      <div className="mt-6">
        <DailyTrendChart daily={summary.daily} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankedBarList
          title="Топ букетов по просмотрам"
          items={summary.topProductViews}
          emptyHint="Пока никто не открывал карточку букета."
        />
        <RankedBarList
          title="Топ кнопок по кликам"
          items={summary.topButtonClicks}
          emptyHint="Пока нет ни одного клика."
        />
      </div>

      <div className="mt-6">
        <ProductStatsTable stats={summary.productStats} />
      </div>
    </div>
  );
}
