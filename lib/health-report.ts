import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyStaffTelegram } from "@/lib/n8n";
import { escapeTelegramHtml } from "@/lib/telegram/bot";

// ================================================================
// Чтобы фоновая задача не могла сломаться молча.
//
// Этот проект уже дважды напоролся на одно и то же: вход по СМС был
// сломан месяц (адрес хука указывал в никуда), а планировщик напоминаний
// не был подключён вообще — годовые напоминания не отправлялись ни разу.
// Оба случая нашлись случайно, при разборе других задач. Логи писались
// исправно, но логи никто не читает, пока не заподозрит неладное.
//
// Отсюда правило: задача, работающая без человека, обязана уметь позвать
// человека, когда перестала работать.
//
// Два предохранителя от навязчивости:
//   1. порог — сообщаем не с первого сбоя, а после нескольких подряд,
//      чтобы разовая сетевая заминка не будила никого;
//   2. пауза между повторами — если поломка длится неделю, сообщение
//      придёт раз в сутки, а не 96 раз.
//
// О восстановлении сообщаем отдельно и однократно: знать, что «само
// прошло», не менее важно, чем узнать о поломке.
// ================================================================

const REALERT_AFTER_MS = 24 * 60 * 60 * 1000;

type HealthRow = {
  consecutive_failures: number;
  alerted_at: string | null;
};

/**
 * @param key            имя задачи, например "catalog-sync"
 * @param title          как назвать её в сообщении по-человечески
 * @param ok             прогон удался?
 * @param errorText      что пошло не так (попадёт в сообщение)
 * @param failThreshold  сколько сбоев подряд терпим до первого сообщения
 */
export async function reportHealth(options: {
  key: string;
  title: string;
  ok: boolean;
  errorText?: string;
  failThreshold?: number;
}): Promise<void> {
  const { key, title, ok, errorText, failThreshold = 3 } = options;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: previous } = await supabaseAdmin
      .from("health_checks")
      .select("consecutive_failures, alerted_at")
      .eq("key", key)
      .maybeSingle();

    const before = (previous as HealthRow | null) ?? { consecutive_failures: 0, alerted_at: null };

    if (ok) {
      // Сообщаем о восстановлении только если раньше жаловались — иначе
      // каждый успешный прогон превращался бы в уведомление.
      if (before.alerted_at) {
        await notifyStaffTelegram(
          `✅ <b>${escapeTelegramHtml(title)}</b> снова работает.\n\n` +
            `Задача отработала успешно после ${before.consecutive_failures} сбоев подряд.`
        );
      }

      await supabaseAdmin.from("health_checks").upsert({
        key,
        consecutive_failures: 0,
        last_error: null,
        alerted_at: null,
        last_ok_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return;
    }

    const failures = before.consecutive_failures + 1;
    const alertedAgo = before.alerted_at ? Date.now() - new Date(before.alerted_at).getTime() : Infinity;
    const shouldAlert = failures >= failThreshold && alertedAgo >= REALERT_AFTER_MS;

    if (shouldAlert) {
      await notifyStaffTelegram(
        `⚠️ <b>${escapeTelegramHtml(title)}</b> не работает.\n\n` +
          `Сбоев подряд: ${failures}\n` +
          `Причина: ${escapeTelegramHtml((errorText ?? "неизвестна").slice(0, 400))}\n\n` +
          `Сайт при этом работает — не отрабатывает только эта фоновая задача.`
      );
    }

    await supabaseAdmin.from("health_checks").upsert({
      key,
      consecutive_failures: failures,
      last_error: (errorText ?? "").slice(0, 1000) || null,
      alerted_at: shouldAlert ? new Date().toISOString() : before.alerted_at,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    // Контроль здоровья не должен ронять саму задачу, за которой следит.
    console.error(`[reportHealth] ${key}:`, error);
  }
}
