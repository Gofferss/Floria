"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  SearchIcon,
  CartIcon,
  UserIcon,
  MenuIcon,
  CloseIcon,
} from "@/components/ui/Icons";
import { useCart } from "@/components/cart/CartProvider";

const NAV_LINKS = [
  { href: "/catalog", label: "Букеты" },
  // «Свадьба» ведёт в отфильтрованный каталог — отдельной страницы /wedding нет
  { href: "/catalog?category=svadebnaya-floristika", label: "Свадьба" },
  { href: "/about", label: "О нас" },
  { href: "/delivery", label: "Доставка" },
  { href: "/blog", label: "Блог" },
  { href: "/contacts", label: "Контакты" },
];

const bonusFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

type HeaderViewProps = {
  isLoggedIn: boolean;
  bonusBalance: number | null;
};

export function HeaderView({ isLoggedIn, bonusBalance }: HeaderViewProps) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { itemCount, openDrawer } = useCart();
  const bonusLabel = isLoggedIn && bonusBalance !== null ? `Бонусы: ${bonusFormatter.format(bonusBalance)}` : null;

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = searchQuery.trim();
    router.push(query ? `/catalog?q=${encodeURIComponent(query)}` : "/catalog");
    setSearchOpen(false);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-lavender-100 bg-white/90 backdrop-blur">
      {/* grid вместо flex+justify-between: три чёткие колонки —
          логотип (auto) / навигация (1fr, центрируется) / поиск+иконки (auto) */}
      <div className="mx-auto grid h-20 max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-6 px-4 sm:px-6 lg:px-8">
        {/* Логотип — горизонтальная версия. Раньше был lg:h-[70px] — почти
            во всю высоту 80px-шапки, из-за чего навигации не хватало места
            и пункты меню переносились на вторую строку. */}
        <Link href="/" className="flex shrink-0 items-center">
          <Image
            src="/logo.png"
            alt="Floria — студия цветов"
            width={260}
            height={70}
            priority
            className="h-9 w-auto sm:h-11 lg:h-12"
          />
        </Link>

        {/* Навигация — десктоп, центрируется в оставшемся пространстве.
            whitespace-nowrap — чтобы «О НАС» и подобные короткие пункты
            не переносились по слову при небольшом сжатии. */}
        <nav className="hidden items-center justify-center gap-6 lg:flex xl:gap-8">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap font-display text-sm font-medium uppercase tracking-wide text-ink/80 transition hover:text-gold-600"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Поиск + иконки — справа */}
        <div className="flex items-center justify-end gap-2 sm:gap-3">
          {/* Поиск — десктоп, всегда виден. Ширина растёт постепенно
              (160px → 180px → 320px), а не сразу занимает 320px на lg,
              где и так тесно логотипу, навигации и иконкам одновременно. */}
          <form
            onSubmit={handleSearchSubmit}
            className="relative hidden w-full max-w-[160px] md:block lg:max-w-[180px] xl:max-w-xs"
          >
            <label className="relative block">
              <span className="sr-only">Поиск по каталогу</span>
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Найти букет..."
                className="w-full rounded-full border border-lavender-200 bg-lavender-50 py-2.5 pl-10 pr-4 font-body text-sm text-ink placeholder:text-ink/40 outline-none transition focus:border-gold-400 focus:bg-white focus:ring-2 focus:ring-gold-400/20"
              />
            </label>
          </form>

          {/* Поиск — мобильный триггер */}
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full text-ink transition hover:bg-lavender-50"
            aria-label="Открыть поиск"
          >
            <SearchIcon className="h-5 w-5" />
          </button>

          {/* Корзина */}
          <button
            type="button"
            onClick={openDrawer}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-ink transition hover:bg-lavender-50"
            aria-label="Открыть корзину"
          >
            <CartIcon className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gold-500 text-[10px] font-semibold text-white">
                {itemCount > 9 ? "9+" : itemCount}
              </span>
            )}
          </button>

          {/* Личный кабинет + бонусы */}
          <Link
            href="/account"
            className="hidden sm:flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 transition hover:bg-lavender-50"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-lavender-100 text-ink">
              <UserIcon className="h-4 w-4" />
            </span>
            <span className="flex flex-col leading-tight text-left">
              <span className="font-display text-xs font-semibold text-ink">
                Кабинет
              </span>
              {bonusLabel && (
                <span className="font-body text-[11px] font-medium text-gold-600">
                  {bonusLabel}
                </span>
              )}
            </span>
          </Link>

          <Link
            href="/account"
            className="sm:hidden inline-flex h-10 w-10 items-center justify-center rounded-full text-ink transition hover:bg-lavender-50"
            aria-label="Личный кабинет"
          >
            <UserIcon className="h-5 w-5" />
          </Link>

          {/* Бургер — мобайл */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-full text-ink transition hover:bg-lavender-50"
            aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
          >
            {mobileOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Поисковая строка — раскрывается на мобильных */}
      {searchOpen && (
        <div className="md:hidden border-t border-lavender-100 px-4 py-3">
          <form onSubmit={handleSearchSubmit}>
            <label className="relative block">
              <span className="sr-only">Поиск по каталогу</span>
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
              <input
                type="search"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Найти букет..."
                className="w-full rounded-full border border-lavender-200 bg-lavender-50 py-2.5 pl-10 pr-4 font-body text-sm text-ink placeholder:text-ink/40 outline-none focus:border-gold-400 focus:bg-white"
              />
            </label>
          </form>
        </div>
      )}

      {/* Мобильное меню */}
      {mobileOpen && (
        <nav className="lg:hidden border-t border-lavender-100 bg-white px-4 py-4">
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-xl px-3 py-3 font-display text-sm font-medium uppercase tracking-wide text-ink transition hover:bg-lavender-50"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="sm:hidden mt-1 border-t border-lavender-100 pt-3">
              <Link
                href="/account"
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-lavender-50"
              >
                <span className="font-display text-sm font-medium text-ink">Личный кабинет</span>
                {bonusLabel && (
                  <span className="font-body text-xs font-medium text-gold-600">{bonusLabel}</span>
                )}
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
