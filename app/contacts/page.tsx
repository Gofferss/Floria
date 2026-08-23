import type { Metadata } from "next";
import { PageHeader } from "@/components/info/PageHeader";
import { YandexMapEmbed } from "@/components/info/YandexMapEmbed";
import { ContactForm } from "@/components/info/ContactForm";
import {
  ClockIcon,
  MailIcon,
  PhoneIcon,
  PinIcon,
  StarIcon,
  TelegramIcon,
} from "@/components/ui/Icons";
import { CONTACTS } from "@/lib/contacts";

export const metadata: Metadata = {
  title: "Контакты — студия цветов Floria в Симферополе",
  description: `Адрес студии Floria: ${CONTACTS.addressFull}. Телефон ${CONTACTS.phone}, работаем ${CONTACTS.hoursShort}.`,
};

export default function ContactsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Контакты"
        title="Мы рядом — заходите или звоните"
        description="Студия работает без выходных. Заезжайте за букетом лично или оформите доставку по Симферополю — соберём в день заказа."
      />

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_400px] lg:gap-14">
          {/* Контактные данные + карта */}
          <div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ContactTile icon={<PinIcon className="h-5 w-5" />} label="Адрес студии">
                <p className="font-body text-base text-ink">{CONTACTS.addressFull}</p>
              </ContactTile>

              <ContactTile icon={<ClockIcon className="h-5 w-5" />} label="Режим работы">
                <p className="font-body text-base text-ink">{CONTACTS.hours}</p>
                <p className="mt-1 font-body text-sm text-ink/50">Без выходных и праздников</p>
              </ContactTile>

              <ContactTile icon={<PhoneIcon className="h-5 w-5" />} label="Телефон">
                <a
                  href={`tel:${CONTACTS.phoneHref}`}
                  className="block font-display text-lg font-semibold text-ink transition hover:text-gold-600"
                >
                  {CONTACTS.phone}
                </a>
                <a
                  href={`tel:${CONTACTS.phoneSecondaryHref}`}
                  className="block font-display text-sm font-medium text-ink/60 transition hover:text-gold-600"
                >
                  {CONTACTS.phoneSecondary}
                </a>
                <p className="mt-1 font-body text-sm text-ink/50">
                  Звонки и мессенджеры в рабочее время
                </p>
              </ContactTile>

              <ContactTile icon={<MailIcon className="h-5 w-5" />} label="Почта">
                <a
                  href={`mailto:${CONTACTS.email}`}
                  className="font-body text-base text-ink transition hover:text-gold-600"
                >
                  {CONTACTS.email}
                </a>
                <p className="mt-1 font-body text-sm text-ink/50">
                  Для сотрудничества и корпоративных заказов
                </p>
              </ContactTile>
            </div>

            {/* Соцсети */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="font-display text-sm font-medium text-ink">Каталог букетов в Telegram:</span>
              <a
                href={CONTACTS.telegram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Telegram"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-lavender-200 text-gold-600 transition hover:border-gold-400 hover:bg-gold-500 hover:text-white"
              >
                <TelegramIcon className="h-4 w-4" />
              </a>
            </div>

            {/* Яндекс.Карта */}
            <div className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold text-ink">Как нас найти</h2>
                <a
                  href={CONTACTS.yandexReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-gold-400/50 bg-gold-50 px-4 py-2 font-display text-xs font-semibold text-gold-700 transition hover:border-gold-500 hover:bg-gold-100"
                >
                  <StarIcon className="h-3.5 w-3.5" />
                  Оставить отзыв на Яндекс.Картах
                </a>
              </div>
              <div className="mt-4 overflow-hidden rounded-3xl border border-lavender-100 bg-lavender-50">
                <YandexMapEmbed
                  src={CONTACTS.yandexMapSrc}
                  title={`Студия цветов Floria на карте — ${CONTACTS.addressFull}`}
                />
              </div>
              <p className="mt-3 font-body text-sm text-ink/50">
                Вход со стороны Киевской улицы. Рядом есть парковка на несколько мест.
              </p>
            </div>
          </div>

          {/* Форма */}
          <div className="lg:sticky lg:top-28 lg:self-start">
            <ContactForm />
          </div>
        </div>
      </div>
    </>
  );
}

function ContactTile({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lavender-50 text-gold-600 ring-1 ring-gold-400/20">
          {icon}
        </span>
        <span className="font-display text-sm font-semibold uppercase tracking-wide text-ink/50">
          {label}
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
