import Link from "next/link";
import { TelegramIcon } from "@/components/ui/Icons";
import { CONTACTS } from "@/lib/contacts";

const NAV_LINKS = [
  { href: "/catalog", label: "Букеты" },
  { href: "/catalog?category=svadebnaya-floristika", label: "Свадьба" },
  { href: "/about", label: "О нас" },
  { href: "/delivery", label: "Доставка и оплата" },
  { href: "/blog", label: "Блог" },
  { href: "/contacts", label: "Контакты" },
];

export function Footer() {
  return (
    <footer className="bg-plum-900 pt-16 pb-8 text-lavender-100">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {/* Логотип + соцсети */}
          <div>
            <span className="font-display text-2xl font-bold text-white">Floria</span>
            <p className="mt-3 max-w-xs font-body text-sm leading-relaxed text-lavender-100/70">
              Студия цветов в Симферополе. Авторские букеты и доставка день в день.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <a
                href={CONTACTS.telegram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Telegram"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gold-400/40 text-gold-400 transition hover:bg-gold-500 hover:text-plum-900"
              >
                <TelegramIcon className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Навигация */}
          <div>
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-lavender-100/50">
              Навигация
            </h3>
            <ul className="mt-4 flex flex-col gap-2.5">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="font-body text-sm text-lavender-100/80 transition hover:text-gold-400"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Контакты */}
          <div>
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-lavender-100/50">
              Контакты
            </h3>
            <div className="mt-4 flex flex-col gap-1">
              <a
                href={`tel:${CONTACTS.phoneHref}`}
                className="font-display text-lg font-semibold text-white transition hover:text-gold-400"
              >
                {CONTACTS.phone}
              </a>
              <a
                href={`tel:${CONTACTS.phoneSecondaryHref}`}
                className="font-display text-sm font-medium text-lavender-100/70 transition hover:text-gold-400"
              >
                {CONTACTS.phoneSecondary}
              </a>
              <a
                href={`mailto:${CONTACTS.email}`}
                className="mt-1 font-body text-sm text-lavender-100/70 transition hover:text-gold-400"
              >
                {CONTACTS.email}
              </a>
              <Link
                href="/contacts"
                className="font-body text-sm text-lavender-100/70 underline decoration-white/20 underline-offset-4 transition hover:text-gold-400"
              >
                Обратный звонок
              </Link>
            </div>
          </div>

          {/* Адрес и время работы */}
          <div>
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-lavender-100/50">
              Студия
            </h3>
            <p className="mt-4 font-body text-sm leading-relaxed text-lavender-100/80">
              {CONTACTS.city}, {CONTACTS.addressLine}
              <br />
              {CONTACTS.hours}
            </p>
            <Link
              href="/contacts"
              className="mt-3 inline-block font-body text-sm text-gold-400 underline decoration-gold-400/40 underline-offset-4 transition hover:text-gold-300"
            >
              Показать на карте
            </Link>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-body text-xs text-lavender-100/50">
            © {new Date().getFullYear()} Floria. Все права защищены.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/privacy"
              className="font-body text-xs text-lavender-100/50 transition hover:text-gold-400"
            >
              Политика конфиденциальности
            </Link>
            <Link
              href="/consent"
              className="font-body text-xs text-lavender-100/50 transition hover:text-gold-400"
            >
              Согласие на обработку персональных данных
            </Link>
            <Link
              href="/cookies"
              className="font-body text-xs text-lavender-100/50 transition hover:text-gold-400"
            >
              Файлы cookie
            </Link>
            <Link
              href="/offer"
              className="font-body text-xs text-lavender-100/50 transition hover:text-gold-400"
            >
              Публичная оферта
            </Link>
            <Link
              href="/contacts"
              className="font-body text-xs text-lavender-100/50 transition hover:text-gold-400"
            >
              Контакты и реквизиты
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
