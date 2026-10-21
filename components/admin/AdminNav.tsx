import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { canUseSiteAdmin } from "@/lib/auth/roles";

// siteOnly — разделы, которые флористу не открыты (см. lib/auth/roles.ts).
const NAV_LINKS = [
  { href: "/admin", label: "Дашборд", siteOnly: true },
  { href: "/admin/orders", label: "Заказы", siteOnly: false },
  // Учёт — отдельное приложение со своим каркасом, отсюда только вход в него.
  { href: "/uchet", label: "Учёт ↗", siteOnly: false },
  { href: "/admin/blog", label: "Блог", siteOnly: true },
  { href: "/admin/catalog", label: "Каталог", siteOnly: true },
  { href: "/admin/categories", label: "Категории", siteOnly: true },
  { href: "/admin/stories", label: "Сторис", siteOnly: true },
  { href: "/admin/promo-codes", label: "Промокоды", siteOnly: true },
  { href: "/admin/analytics", label: "Метрики", siteOnly: true },
  { href: "/admin/broadcast", label: "Рассылка", siteOnly: true },
];

export function AdminNav({ role }: { role: string }) {
  const links = canUseSiteAdmin(role) ? NAV_LINKS : NAV_LINKS.filter((l) => !l.siteOnly);

  return (
    <header className="sticky top-0 z-40 border-b border-lavender-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/admin" className="font-display text-sm font-bold uppercase tracking-widest text-gold-600">
          Floria — Админка
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {links.map((link) => (
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
