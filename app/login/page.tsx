import type { Metadata } from "next";
import { Suspense } from "react";
import { PhoneLoginForm } from "@/components/auth/PhoneLoginForm";
import { StaffLoginToggle } from "@/components/auth/StaffLoginToggle";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { TelegramIcon } from "@/components/ui/Icons";
import { CONTACTS } from "@/lib/contacts";

export const metadata: Metadata = {
  title: "Вход — Floria",
  description: "Вход в личный кабинет студии цветов Floria по коду из СМС.",
};

export default function LoginPage() {
  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-lavender-100 via-lavender-50 to-white">
      <AmbientGlow />

      <div className="relative mx-auto flex min-h-[75vh] max-w-md flex-col justify-center px-4 py-20 sm:px-6 sm:py-24">
        <div className="mb-8 text-center">
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
            Floria
          </span>
          <h1 className="mt-3 font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Личный кабинет
          </h1>
          <p className="mt-3 font-body text-sm leading-relaxed text-ink/60">
            Вход по коду из СМС — без паролей
          </p>
        </div>

        <div className="rounded-3xl border border-lavender-100 bg-white p-7 shadow-[0_24px_60px_-20px_rgba(94,74,150,0.28)] sm:p-9">
          {/* useSearchParams требует Suspense-границу в App Router */}
          <Suspense fallback={null}>
            <PhoneLoginForm />
          </Suspense>
        </div>

        {/* Альтернативный способ получить код.
            Пока имя отправителя не одобрено операторами связи, СМС доходят
            не на все номера, и человеку нужен работающий путь прямо здесь,
            а не сообщение об ошибке после неудачной попытки.

            Это справочная информация о правилах пользования собственным
            сервисом на собственном сайте — по разъяснениям ФАС такие
            сведения рекламой не являются (п. 2 ч. 2 ст. 2 ФЗ «О рекламе»),
            а запрет из ч. 10.7 ст. 5 касается размещения рекламы НА
            ограниченном ресурсе, а не ссылки на него со своего сайта. */}
        <div className="mt-6 rounded-3xl border border-lavender-100 bg-white/70 p-5 text-center">
          <p className="font-display text-sm font-semibold text-ink">
            Код не приходит?
          </p>
          <p className="mt-2 font-body text-sm leading-relaxed text-ink/60">
            У некоторых операторов связи СМС пока не доставляются. Получите код в
            нашем боте: откройте его, нажмите «Поделиться номером» — и вернитесь
            сюда, код придёт в чат.
          </p>
          <a
            href={CONTACTS.telegramBot}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold-400/60 bg-gold-50 px-5 py-2.5 font-display text-sm font-semibold text-gold-700 transition hover:border-gold-500 hover:bg-gold-100"
          >
            <TelegramIcon className="h-4 w-4" />
            Открыть бота Floria
          </a>
          <p className="mt-3 font-body text-xs text-ink/45">
            Или позвоните нам — оформим заказ без входа:{" "}
            <a
              href={`tel:+${CONTACTS.phone.replace(/\D/g, "")}`}
              className="whitespace-nowrap underline underline-offset-2 transition hover:text-gold-600"
            >
              {CONTACTS.phone}
            </a>
          </p>
        </div>

        <Suspense fallback={null}>
          <StaffLoginToggle />
        </Suspense>
      </div>
    </div>
  );
}
