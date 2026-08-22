import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/info/PageHeader";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CardIcon,
  CheckIcon,
  ClockIcon,
  PhoneIcon,
  QrIcon,
  TruckIcon,
} from "@/components/ui/Icons";
import {
  DELIVERY_PRICE,
  ASAP_SURCHARGE,
  SAME_DAY_CUTOFF_HOUR,
  MADE_TO_ORDER_LEAD_DAYS,
  TIME_SLOTS,
} from "@/lib/checkout";
import { CONTACTS } from "@/lib/contacts";

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export const metadata: Metadata = {
  title: "Доставка и оплата — студия цветов Floria",
  description: `Доставка букетов по Симферополю — ${DELIVERY_PRICE} ₽, интервалы с 8:00 до 22:00, самовывоз бесплатно. Оплата наличными, картой и через СБП.`,
};

// Интервалы берём из тех же констант, что и форма оформления заказа,
// чтобы информация на странице не разошлась с реальными вариантами в корзине.
const namedSlots = TIME_SLOTS.filter((slot) => slot.from && slot.to);

export default function DeliveryPage() {
  return (
    <>
      <PageHeader
        eyebrow="Доставка и оплата"
        title="Привезём букет вовремя"
        description="Работаем по Симферополю каждый день с 8:00 до 22:00. Собираем букет в день доставки, а если получатель — сюрприз, сами уточним у него адрес."
      />

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        {/* Ключевые условия */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
          <HighlightCard
            icon={<TruckIcon className="h-6 w-6" />}
            title={currency.format(DELIVERY_PRICE)}
            subtitle="доставка по Симферополю"
          />
          <HighlightCard
            icon={<CheckIcon className="h-6 w-6" />}
            title="Самовывоз"
            subtitle="бесплатно, из студии на Киевской"
          />
          <HighlightCard
            icon={<ClockIcon className="h-6 w-6" />}
            title="8:00 — 22:00"
            subtitle="ежедневно, без выходных"
          />
        </div>

        {/* Доставка */}
        <section className="mt-14 lg:mt-20">
          <h2 className="font-display text-2xl font-bold text-ink sm:text-3xl">
            Как работает доставка
          </h2>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
            <InfoBlock title="Зона и стоимость">
              <ul className="flex flex-col gap-3">
                <Bullet>
                  Доставляем по Симферополю в пределах города — стоимость{" "}
                  {currency.format(DELIVERY_PRICE)}.
                </Bullet>
                <Bullet>
                  Срочная доставка «как можно скорее» — плюс{" "}
                  {currency.format(ASAP_SURCHARGE)}: курьер выезжает отдельно, вне общего
                  маршрута.
                </Bullet>
                <Bullet>
                  За пределы города и в другие населённые пункты Крыма — по договорённости,
                  уточняйте по телефону.
                </Bullet>
                <Bullet>
                  Самовывоз из студии по адресу {CONTACTS.addressLine} — бесплатно и в любое
                  рабочее время. Выбирается при оформлении заказа.
                </Bullet>
              </ul>
            </InfoBlock>

            <InfoBlock title="Интервалы доставки">
              <p className="font-body text-sm leading-relaxed text-ink/70">
                Выберите удобное окно при оформлении заказа. Курьер приезжает внутри интервала
                и заранее звонит получателю.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {namedSlots.map((slot) => (
                  <span
                    key={slot.id}
                    className="rounded-full border border-lavender-200 bg-lavender-50 px-3.5 py-1.5 font-body text-sm text-ink/80"
                  >
                    {slot.label}
                  </span>
                ))}
              </div>
              <p className="mt-4 font-body text-sm leading-relaxed text-ink/60">
                Есть и вариант «как можно скорее» — соберём и отправим ближайшим рейсом,
                доплата {currency.format(ASAP_SURCHARGE)} за отдельный выезд курьера.
              </p>
              <p className="mt-3 font-body text-sm leading-relaxed text-ink/60">
                Заказы на текущий день принимаем до {SAME_DAY_CUTOFF_HOUR}:00 — позже выберите
                следующую дату или позвоните, обсудим возможность.
              </p>
            </InfoBlock>

            <InfoBlock title="Букеты «под заказ»">
              <p className="font-body text-sm leading-relaxed text-ink/70">
                Часть букетов мы собираем под конкретный заказ — из цветов, которых сейчас нет
                на витрине. Такие позиции отмечены в каталоге, и для них нужен запас минимум
                в {MADE_TO_ORDER_LEAD_DAYS} дня.
              </p>
              <p className="mt-3 font-body text-sm leading-relaxed text-ink/60">
                Это время уходит на то, чтобы заказать и привезти нужные цветы, а не собрать из
                того, что осталось. При оформлении календарь сам предложит ближайшую доступную
                дату.
              </p>
            </InfoBlock>

            <InfoBlock title="Не знаете адрес получателя?">
              <p className="font-body text-sm leading-relaxed text-ink/70">
                Это обычная ситуация с сюрпризами. Оставьте в заказе только имя и телефон
                получателя — мы сами свяжемся с ним, аккуратно уточним удобные адрес и время,
                не раскрывая, от кого букет.
              </p>
              <ul className="mt-4 flex flex-col gap-3">
                <Bullet>Не говорим, кто отправитель, если вы этого не просили</Bullet>
                <Bullet>Согласуем время, чтобы получатель точно был на месте</Bullet>
                <Bullet>Сообщим вам, когда букет будет вручён</Bullet>
              </ul>
            </InfoBlock>

            <InfoBlock title="Анонимная доставка и открытка">
              <p className="font-body text-sm leading-relaxed text-ink/70">
                К каждому букету бесплатно прилагаем открытку — текст вы пишете при оформлении
                заказа, а флорист переносит его от руки на карточку.
              </p>
              <ul className="mt-4 flex flex-col gap-3">
                <Bullet>Открытка бесплатна, до 200 символов</Bullet>
                <Bullet>Можно оставить анонимной — без имени отправителя</Bullet>
                <Bullet>Если букет не приняли, привезём его вам или вернём деньги</Bullet>
              </ul>
            </InfoBlock>
          </div>
        </section>

        {/* Оплата */}
        <section className="mt-14 lg:mt-20">
          <h2 className="font-display text-2xl font-bold text-ink sm:text-3xl">
            Способы оплаты
          </h2>
          <p className="mt-3 max-w-2xl font-body text-base leading-relaxed text-ink/60">
            Выберите удобный вариант при оформлении заказа. Чек присылаем в мессенджер или на
            почту.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
            <PaymentCard
              icon={<QrIcon className="h-6 w-6" />}
              title="СБП"
              description="Оплата по QR-коду через приложение любого банка. Деньги зачисляются мгновенно, комиссии для вас нет."
            />
            <PaymentCard
              icon={<CardIcon className="h-6 w-6" />}
              title="Банковский перевод"
              description="Пришлём реквизиты после оформления заказа. Удобно, если оплачивает другой человек или нужен безналичный расчёт."
            />
            <PaymentCard
              icon={<BanknoteIcon className="h-6 w-6" />}
              title="Наличными"
              description="В студии при самовывозе или курьеру при вручении букета. Сдача будет — предупредите, с какой суммы."
            />
          </div>

          <div className="mt-6 rounded-3xl border border-lavender-100 bg-white p-5 sm:p-6">
            <h3 className="font-display text-base font-semibold text-ink">Про бонусы</h3>
            <p className="mt-2 font-body text-sm leading-relaxed text-ink/70">
              За каждый заказ начисляем бонусы на счёт в личном кабинете — 1 бонус равен 1 ₽.
              Списать их можно при следующей покупке прямо в корзине, частично или полностью.
            </p>
          </div>
        </section>

        {/* Телеграм-бот */}
        <section className="mt-14 lg:mt-20">
          <div className="rounded-3xl border border-lavender-200 bg-lavender-50/60 p-6 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
                  Telegram-бот
                </span>
                <h2 className="mt-2 font-display text-2xl font-bold text-ink">
                  Не забыть про важную дату
                </h2>
                <p className="mt-3 font-body text-base leading-relaxed text-ink/70">
                  У нас есть бот, который напомнит о дне рождения или годовщине заранее — за
                  столько дней, сколько скажете. Чтобы вы успели заказать букет спокойно, а не
                  в последний момент.
                </p>
                <ul className="mt-4 flex flex-col gap-2.5">
                  <Bullet>Напомнит о дате заранее — вы сами выбираете, за сколько дней</Bullet>
                  <Bullet>Покажет ваш бонусный баланс</Bullet>
                  <Bullet>Пришлёт код для входа на сайт прямо в Telegram, без ожидания СМС</Bullet>
                </ul>
              </div>
              <Link
                href={CONTACTS.telegramBot}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-lavender-600 px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-lavender-700"
              >
                Открыть бота
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mt-14 rounded-3xl bg-plum-900 p-7 sm:p-10 lg:mt-20">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">
                Остались вопросы?
              </h2>
              <p className="mt-2 max-w-lg font-body text-base leading-relaxed text-lavender-100/70">
                Позвоните — подскажем по срокам, зоне доставки и подберём букет под ваш бюджет.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:items-end">
              <a
                href={`tel:${CONTACTS.phoneHref}`}
                className="inline-flex items-center gap-2 rounded-full bg-gold-500 px-7 py-4 font-display text-sm font-semibold text-white transition hover:bg-gold-600"
              >
                <PhoneIcon className="h-4 w-4" />
                {CONTACTS.phone}
              </a>
              <Link
                href="/contacts"
                className="inline-flex items-center gap-1 font-display text-sm font-medium text-lavender-100/80 transition hover:text-gold-400"
              >
                Все контакты и карта
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function HighlightCard({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-6">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-lavender-50 text-gold-600 ring-1 ring-gold-400/20">
        {icon}
      </span>
      <p className="mt-4 font-display text-xl font-bold text-ink sm:text-2xl">{title}</p>
      <p className="mt-1 font-body text-sm text-ink/60">{subtitle}</p>
    </div>
  );
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-7">
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 font-body text-sm leading-relaxed text-ink/70">
      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gold-500/15 text-gold-600">
        <CheckIcon className="h-2.5 w-2.5" />
      </span>
      {children}
    </li>
  );
}

function PaymentCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-lavender-100 bg-white p-5 sm:p-6">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-lavender-50 text-gold-600 ring-1 ring-gold-400/20">
        {icon}
      </span>
      <h3 className="mt-4 font-display text-base font-semibold text-ink">{title}</h3>
      <p className="mt-2 font-body text-sm leading-relaxed text-ink/60">{description}</p>
    </div>
  );
}
