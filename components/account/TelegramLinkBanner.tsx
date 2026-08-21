import { CONTACTS } from "@/lib/contacts";
import { PhoneIcon } from "@/components/ui/Icons";

/**
 * Показывается, только если телефон клиента ещё НЕ привязан к боту
 * (app/account/page.tsx сам решает, вызывать ли этот компонент — см.
 * там же bot_users.phone). Сама привязка происходит в самом боте
 * (кнопка "Получать код входа сюда" → "Поделиться номером"), сайт
 * только зовёт туда — здесь нечего проверять/отправлять самим.
 */
export function TelegramLinkBanner() {
  return (
    <div className="rounded-3xl border border-lavender-200 bg-lavender-50/60 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lavender-100 text-lavender-600">
          <PhoneIcon className="h-4 w-4" />
        </span>
        <div>
          <p className="font-display text-sm font-semibold text-ink">Получайте код входа быстрее</p>
          <p className="mt-1 font-body text-sm leading-relaxed text-ink/60">
            Подключите нашего Telegram-бота — код придёт туда сразу, без ожидания СМС.
          </p>
        </div>
      </div>

      <a
        href={CONTACTS.telegramBot}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-lavender-600 px-6 py-3 font-display text-sm font-semibold text-white transition hover:bg-lavender-700"
      >
        Подключить в Telegram
      </a>
    </div>
  );
}
