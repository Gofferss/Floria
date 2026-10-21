import Link from "next/link";
import { ui } from "@/components/uchet/ui";

type Tab = "stock" | "docs" | "settings";

const TABS: { key: Tab; href: string; label: string }[] = [
  { key: "stock", href: "/uchet/sklad", label: "Остатки" },
  { key: "docs", href: "/uchet/sklad/docs", label: "Документы" },
  { key: "settings", href: "/uchet/sklad/settings", label: "Справочники" },
];

const ACTIONS: { href: string; label: string; primary?: boolean }[] = [
  { href: "/uchet/sklad/docs/new?type=receipt", label: "+ Приход", primary: true },
  { href: "/uchet/sklad/docs/new?type=writeoff", label: "Списание" },
  { href: "/uchet/sklad/docs/new?type=inventory", label: "Инвентаризация" },
];

/**
 * Вкладки склада и три главных действия. У Posiflora каждый вид документа —
 * отдельный пункт меню (приходные накладные, накладные на списание, акты
 * инвентаризаций…); здесь все документы в одной вкладке, а вид — фильтром.
 */
export function SkladHeader({ active, title, subtitle }: { active: Tab; title?: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-xl bg-zinc-200/60 p-1" aria-label="Разделы склада">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={t.key === active ? "page" : undefined}
              className={`flex min-h-[40px] items-center rounded-lg px-4 text-sm font-semibold transition ${
                t.key === active ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <Link key={a.href} href={a.href} className={a.primary ? ui.btnPrimary : ui.btnSecondary}>
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      {title && <h1 className={`${ui.h1} mt-5`}>{title}</h1>}
      {subtitle && <p className={`${ui.muted} mt-1.5 max-w-3xl`}>{subtitle}</p>}
    </div>
  );
}
