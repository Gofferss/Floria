import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/info/PageHeader";
import { CardIcon, QrIcon, CheckIcon, PhoneIcon } from "@/components/ui/Icons";
import { CONTACTS } from "@/lib/contacts";

export const metadata: Metadata = {
  title: "Оплата и безопасность платежей — студия цветов Floria",
  description:
    "Как оплатить заказ в Floria: СБП и банковские карты МИР, Visa, Mastercard. Безопасность платежей, порядок отмены заказа и возврата денежных средств.",
};

// ================================================================
// Страница заведена по требованиям банка к интернет-магазину (пункт 8
// «Требований к Интернет-магазину Предприятия» ВТБ): витрина обязана
// содержать порядок оплаты картой, разъяснение мер безопасности,
// процедуру возврата товара и денег и порядок отмены операции.
//
// Держим отдельной страницей, а не абзацем на /delivery: банк проверяет
// наличие этих сведений перед подключением эквайринга, и одну ссылку
// показать проще, чем объяснять, где искать нужный раздел.
//
// Условия возврата ЗДЕСЬ И В ОФЕРТЕ должны совпадать. Если меняете тут —
// правьте и /offer, раздел 7: расхождение между витриной и договором
// хуже, чем отсутствие страницы.
// ================================================================

const PAYMENT_SYSTEMS = ["МИР", "VISA", "Mastercard"];

export default function PaymentPage() {
  return (
    <>
      <PageHeader
        eyebrow="Оплата"
        title="Оплата и безопасность платежей"
        description="Принимаем оплату онлайн — через Систему быстрых платежей и банковской картой. Рассказываем, как это устроено и что происходит с деньгами, если заказ отменяется."
      />

      <div className="mx-auto max-w-3xl px-4 pb-20 sm:px-6 lg:px-8">
        {/* ---------- Способы оплаты ---------- */}
        <section className="mb-12">
          <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">Способы оплаты</h2>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-lavender-100 bg-white p-6">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-lavender-50 text-gold-600 ring-1 ring-gold-400/20">
                <QrIcon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold text-ink">
                Система быстрых платежей
              </h3>
              <p className="mt-1.5 font-body text-sm leading-relaxed text-ink/60">
                Оплата по QR-коду или кнопкой в приложении вашего банка. Деньги зачисляются
                мгновенно, комиссии для вас нет.
              </p>
            </div>

            <div className="rounded-3xl border border-lavender-100 bg-white p-6">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-lavender-50 text-gold-600 ring-1 ring-gold-400/20">
                <CardIcon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold text-ink">Банковская карта</h3>
              <p className="mt-1.5 font-body text-sm leading-relaxed text-ink/60">
                Оплата на защищённой странице банка. Реквизиты карты вводятся там же и на наш
                сайт не передаются.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-lavender-100 bg-lavender-50/40 px-6 py-5">
            <p className="font-body text-sm text-ink/70">К оплате принимаются карты:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PAYMENT_SYSTEMS.map((name) => (
                <span
                  key={name}
                  className="rounded-xl border border-lavender-200 bg-white px-4 py-2 font-display text-sm font-semibold tracking-wide text-ink"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Как проходит оплата ---------- */}
        <section className="mb-12">
          <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">Как проходит оплата</h2>
          <ol className="mt-6 space-y-4">
            {[
              "Соберите букет в корзину и заполните форму заказа: кому, куда и когда доставить.",
              "Нажмите «Оплатить заказ» — мы перенаправим вас на защищённую платёжную страницу банка ВТБ (ПАО).",
              "Выберите оплату по QR-коду через СБП или введите реквизиты банковской карты.",
              "После успешной оплаты вы вернётесь на наш сайт, а заказ сразу уйдёт флористу в работу.",
            ].map((step, index) => (
              <li key={index} className="flex gap-4">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-500 font-display text-xs font-bold text-white">
                  {index + 1}
                </span>
                <p className="font-body text-sm leading-relaxed text-ink/70">{step}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- Безопасность ---------- */}
        <section className="mb-12">
          <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">
            Безопасность платежей и конфиденциальность
          </h2>

          <div className="mt-6 space-y-3">
            {[
              "Оплата проходит через процессинговый центр банка ВТБ (ПАО). Реквизиты вашей карты вводятся на странице банка и студии Floria не передаются — мы их не видим и не храним.",
              "Соединение с платёжной страницей защищено протоколом TLS с длиной ключа 256 бит. Данные передаются в зашифрованном виде по закрытым каналам связи.",
              "Операции по картам выполняются в соответствии с правилами платёжных систем МИР, Visa Int. и Mastercard Europe Sprl, а также с требованиями стандарта безопасности PCI DSS, которым соответствует процессинг банка.",
              "Для подтверждения операции банк может запросить одноразовый код по технологии 3-D Secure. Этот код никому не сообщайте — сотрудники Floria его не спрашивают.",
              "Введённые вами данные не передаются третьим лицам, за исключением случаев, предусмотренных законодательством Российской Федерации.",
            ].map((text, index) => (
              <div key={index} className="flex gap-3">
                <CheckIcon className="mt-1 h-4 w-4 shrink-0 text-gold-600" />
                <p className="font-body text-sm leading-relaxed text-ink/70">{text}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 font-body text-sm leading-relaxed text-ink/60">
            Как мы обрабатываем персональные данные, описано в{" "}
            <Link href="/privacy" className="text-gold-600 underline underline-offset-2 hover:text-gold-700">
              Политике конфиденциальности
            </Link>
            .
          </p>
        </section>

        {/* ---------- Отмена и возврат денег ---------- */}
        <section className="mb-12">
          <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">
            Отмена заказа и возврат денежных средств
          </h2>

          <div className="mt-6 space-y-4 font-body text-sm leading-relaxed text-ink/70">
            <p>
              <strong className="font-semibold text-ink">Пока букет не собран</strong> — вы можете
              отменить заказ, позвонив нам по телефону{" "}
              <a href={`tel:${CONTACTS.phoneHref}`} className="text-gold-600 underline underline-offset-2 hover:text-gold-700">
                {CONTACTS.phone}
              </a>
              . Деньги возвращаем полностью.
            </p>
            <p>
              <strong className="font-semibold text-ink">Возврат приходит тем же способом</strong>,
              которым вы платили: на ту же банковскую карту или на счёт, с которого прошла оплата
              через СБП. Наличными или на другие реквизиты возврат по закону невозможен.
            </p>
            <p>
              <strong className="font-semibold text-ink">Сроки.</strong> Мы оформляем возврат в
              течение 1 рабочего дня с момента обращения. Дальше деньги идут по банковским
              правилам: обычно от 1 до 3 рабочих дней, в отдельных случаях — до 30 календарных
              дней. Срок зачисления зависит от вашего банка, а не от студии.
            </p>
            <p>
              <strong className="font-semibold text-ink">Если букет уже доставлен.</strong> Срезанные
              цветы и композиции — скоропортящийся товар растительного происхождения, и по
              Постановлению Правительства РФ от 31.12.2020 № 2463 обмену и возврату как товар
              надлежащего качества не подлежат.
            </p>
            <p>
              Это ограничение <strong className="font-semibold text-ink">не относится к товару
              ненадлежащего качества</strong>. Если с букетом что-то не так — свяжитесь с нами в
              день получения или в течение суток, по возможности приложив фотографии. Мы заменим
              букет или вернём деньги в соответствии с Законом РФ «О защите прав потребителей».
              Подробнее — в разделе 7{" "}
              <Link href="/offer" className="text-gold-600 underline underline-offset-2 hover:text-gold-700">
                публичной оферты
              </Link>
              .
            </p>
          </div>
        </section>

        {/* ---------- Контакты для вопросов по оплате ---------- */}
        <section className="rounded-3xl border border-lavender-100 bg-white px-6 py-8 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-lavender-50 text-gold-600 ring-1 ring-gold-400/20">
            <PhoneIcon className="h-5 w-5" />
          </span>
          <h2 className="mt-4 font-display text-lg font-semibold text-ink">
            Вопросы по оплате или возврату
          </h2>
          <p className="mt-2 font-body text-sm leading-relaxed text-ink/60">
            Звоните{" "}
            <a href={`tel:${CONTACTS.phoneHref}`} className="text-gold-600 underline underline-offset-2 hover:text-gold-700">
              {CONTACTS.phone}
            </a>{" "}
            или пишите на{" "}
            <a href={`mailto:${CONTACTS.email}`} className="text-gold-600 underline underline-offset-2 hover:text-gold-700">
              {CONTACTS.email}
            </a>
            . Отвечаем ежедневно, {CONTACTS.hoursShort}.
          </p>
          <p className="mt-4 font-body text-xs leading-relaxed text-ink/50">
            ИП Сергеева Инна Игоревна · ОГРНИП 314910234302106 · ИНН 910200334837
            <br />
            {CONTACTS.addressFull}
          </p>
        </section>
      </div>
    </>
  );
}
