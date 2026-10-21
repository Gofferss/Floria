import Link from "next/link";

type Tab = "stock" | "docs" | "settings";

const TABS: { key: Tab; href: string; label: string }[] = [
  { key: "stock", href: "/admin/sklad", label: "Остатки" },
  { key: "docs", href: "/admin/sklad/docs", label: "Документы" },
  { key: "settings", href: "/admin/sklad/settings", label: "Справочники" },
];

const ACTIONS: { href: string; label: string; primary?: boolean }[] = [
  { href: "/admin/sklad/docs/new?type=receipt", label: "Приход", primary: true },
  { href: "/admin/sklad/docs/new?type=writeoff", label: "Списание" },
  { href: "/admin/sklad/docs/new?type=inventory", label: "Инвентаризация" },
];

/**
 * Шапка раздела «Склад»: вкладки и три главных действия. Действия
 * вынесены наверх каждой страницы раздела, потому что это то, ради чего
 * сюда заходят: привезли товар, что-то завяло, пересчитали.
 */
export function SkladHeader({ active, title, subtitle }: { active: Tab; title: string; subtitle?: string }) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">Склад</span>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl font-body text-sm text-ink/60">{subtitle}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className={
                a.primary
                  ? "rounded-full bg-gold-500 px-5 py-2.5 font-display text-sm font-semibold text-white shadow-sm transition hover:bg-gold-600"
                  : "rounded-full border border-lavender-200 bg-white px-5 py-2.5 font-display text-sm font-semibold text-ink transition hover:border-gold-400 hover:text-gold-700"
              }
            >
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-lavender-100" aria-label="Разделы склада">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2.5 font-display text-sm font-medium transition ${
              t.key === active
                ? "border-gold-500 text-ink"
                : "border-transparent text-ink/55 hover:border-lavender-300 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
