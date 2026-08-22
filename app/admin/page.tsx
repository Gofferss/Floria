import type { Metadata } from "next";
import Link from "next/link";
import {
  EditIcon,
  PackageIcon,
  TelegramIcon,
  ArrowRightIcon,
  BouquetIcon,
  GiftIcon,
  TagIcon,
  StoryRingIcon,
  ChartBarIcon,
  TruckIcon,
} from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Админка — Floria",
};

const SECTIONS = [
  // Заказы первыми — это то, ради чего в админку заходят чаще всего.
  {
    href: "/admin/orders",
    icon: TruckIcon,
    title: "Заказы",
    description: "Заказы с сайта: состав, адрес, статус и отметка «принят в работу».",
  },
  {
    href: "/admin/blog",
    icon: EditIcon,
    title: "Блог",
    description: "Список статей, публикация и редактирование.",
  },
  {
    href: "/admin/catalog",
    icon: PackageIcon,
    title: "Каталог",
    description: "Букеты: в наличии, под заказ, редактирование карточек.",
  },
  {
    href: "/admin/categories",
    icon: BouquetIcon,
    title: "Категории",
    description: "Карточки на главной и фильтр каталога.",
  },
  {
    href: "/admin/occasions",
    icon: GiftIcon,
    title: "Поводы",
    description: "Список поводов для фильтра и формы товара.",
  },
  {
    href: "/admin/stories",
    icon: StoryRingIcon,
    title: "Сторис",
    description: "Кружки-актуальное на главной: фото, «как нас найти», советы по уходу.",
  },
  {
    href: "/admin/promo-codes",
    icon: TagIcon,
    title: "Промокоды",
    description: "Скидки по коду: условия, лимиты, срок действия.",
  },
  {
    href: "/admin/analytics",
    icon: ChartBarIcon,
    title: "Метрики",
    description: "Просмотры букетов, клики по кнопкам, динамика по дням.",
  },
  {
    href: "/admin/broadcast",
    icon: TelegramIcon,
    title: "Рассылка",
    description: "Сообщение всем подписчикам Telegram-бота.",
  },
];

export default function AdminHomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Админка
        </span>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Что делаем?</h1>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className="group flex flex-col rounded-3xl border border-lavender-100 bg-white p-6 transition hover:-translate-y-1 hover:border-gold-300 hover:shadow-lg"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-lavender-50 text-gold-600 ring-1 ring-gold-400/20">
                <Icon className="h-6 w-6" />
              </span>
              <h2 className="mt-4 font-display text-lg font-semibold text-ink">{section.title}</h2>
              <p className="mt-1.5 flex-1 font-body text-sm leading-relaxed text-ink/60">
                {section.description}
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 font-display text-sm font-medium text-gold-600 transition group-hover:gap-2.5">
                Открыть
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
