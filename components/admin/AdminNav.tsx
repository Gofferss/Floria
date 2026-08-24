import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";

const NAV_LINKS = [
  { href: "/admin", label: "Дашборд" },
  { href: "/admin/orders", label: "Заказы" },
  { href: "/admin/blog", label: "Блог" },
  { href: "/admin/catalog", label: "Каталог" },
  { href: "/admin/categories", label: "Категории" },
  { href: "/admin/stories", label: "Сторис" },
  { href: "/admin/promo-codes", label: "Промокоды" },
  { href: "/admin/analytics", label: "Метрики" },
  { href: "/admin/broadcast", label: "Рассылка" },
];

export function AdminNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-lavender-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/admin" className="font-display text-sm font-bold uppercase tracking-widest text-gold-600">
          Floria — Админка
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 font-display text-sm font-medium text-ink/70 transition hover:bg-lavender-50 hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <LogoutButton className="font-body text-sm text-ink/50 underline decoration-lavender-300 underline-offset-4 transition hover:text-ink" />
      </div>
    </header>
  );
}
