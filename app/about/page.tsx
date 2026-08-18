import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/info/PageHeader";
import { BotanicalPattern } from "@/components/ui/BotanicalPattern";
import {
  ArrowRightIcon,
  ClockIcon,
  GiftIcon,
  LeafIcon,
  SparkleIcon,
  TruckIcon,
} from "@/components/ui/Icons";
import { CONTACTS } from "@/lib/contacts";

export const metadata: Metadata = {
  title: "О студии Floria — авторская флористика в Симферополе",
  description:
    "Студия цветов Floria в Симферополе: свежие поставки, авторские букеты от флористов и собственная бонусная программа.",
};

const ADVANTAGES = [
  {
    icon: LeafIcon,
    title: "Свежие поставки",
    text: "Привозим цветы несколько раз в неделю и не держим остатки «до последнего». Если стебель не проходит наш отбор — он не попадёт в букет.",
  },
  {
    icon: SparkleIcon,
    title: "Авторский стиль",
    text: "Не собираем по шаблону. Флорист подбирает сочетания под повод, характер получателя и то, что действительно хорошо в этот день.",
  },
  {
    icon: GiftIcon,
    title: "Бонусная программа",
    text: "Возвращаем часть суммы бонусами на счёт в личном кабинете. 1 бонус = 1 ₽, списать можно прямо в корзине при следующем заказе.",
  },
  {
    icon: TruckIcon,
    title: "Доставка в день заказа",
    text: "Собираем букет к нужному времени и везём по Симферополю. Если получатель — сюрприз, сами аккуратно уточним у него адрес.",
  },
  {
    icon: ClockIcon,
    title: "Без выходных",
    text: "Работаем каждый день с 8:00 до 22:00, включая праздники — когда цветы нужны чаще всего.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="О студии"
        title="Floria — студия цветов в Симферополе"
        description="Мы собираем букеты так, как собирали бы для близких: из свежей срезки, без шаблонов и лишнего декора ради объёма."
      />

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        {/* Вступление */}
        <section className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div className="max-w-[60ch]">
            <h2 className="font-display text-2xl font-bold text-ink sm:text-3xl">
              Цветы, которые не стыдно подарить
            </h2>
            <p className="mt-4 font-body text-base leading-[1.75] text-ink/70">
              Floria выросла из простой идеи: в городе должно быть место, где букет собирают
              руками, а не выдают с витрины. Мы работаем с небольшим числом проверенных
              поставщиков, забираем срезку сами и отбраковываем всё, что не простоит у вас дома
              достаточно долго.
            </p>
            <p className="mt-4 font-body text-base leading-[1.75] text-ink/70">
              Каждый букет собирает флорист, а не сборщик по инструкции. Поэтому две одинаковые
              позиции из каталога всё равно будут немного разными — и это то, за что нас
              возвращаются.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/catalog"
                className="group inline-flex items-center gap-2 rounded-full bg-gold-500 px-7 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-gold-600"
              >
                Смотреть каталог
                <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/contacts"
                className="font-display text-sm font-medium text-ink/70 underline decoration-lavender-300 decoration-2 underline-offset-4 transition hover:text-ink"
              >
                Как нас найти
              </Link>
            </div>
          </div>

          {/* Декоративная композиция — заменить на фото студии */}
          <div className="relative mx-auto aspect-square w-full max-w-md lg:max-w-none">
            <div
              className="absolute inset-0 bg-gradient-to-br from-lavender-200 via-lavender-100 to-white"
              style={{ borderRadius: "42% 58% 63% 37% / 41% 44% 56% 59%" }}
            />
            <BotanicalPattern className="absolute inset-0 h-full w-full text-gold-500/60" />
          </div>
        </section>

        {/* Преимущества */}
        <section className="mt-16 lg:mt-24">
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
            Почему нас выбирают
          </span>
          <h2 className="mt-2 font-display text-2xl font-bold text-ink sm:text-3xl">
            Что мы делаем иначе
          </h2>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {ADVANTAGES.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-3xl border border-lavender-100 bg-white p-5 transition hover:-translate-y-1 hover:shadow-lg sm:p-6"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-lavender-50 text-gold-600 ring-1 ring-gold-400/20">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-4 font-display text-base font-semibold text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-2 font-body text-sm leading-relaxed text-ink/60">
                    {item.text}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Приглашение в студию */}
        <section className="relative mt-16 overflow-hidden rounded-3xl bg-lavender-100 p-7 sm:p-10 lg:mt-24">
          <BotanicalPattern className="pointer-events-none absolute inset-0 h-full w-full text-lavender-500/50" />

          <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink sm:text-3xl">
                Заходите в студию
              </h2>
              <p className="mt-2 max-w-lg font-body text-base leading-relaxed text-ink/70">
                {CONTACTS.addressFull}. {CONTACTS.hours} — покажем, что есть в наличии сегодня,
                и соберём букет при вас.
              </p>
            </div>
            <Link
              href="/contacts"
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gold-500 px-7 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-gold-600"
            >
              Контакты
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
