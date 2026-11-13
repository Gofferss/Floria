import { getSupabaseAdmin } from "@/lib/supabase";
import { toE164RussianPhone } from "@/lib/phone-mask";

// ================================================================
// Подключил ли клиент Telegram-бота — для экранов заказа.
//
// Тот же признак, по которому бот ищет, куда слать фото букета и этапы
// заказа (findChatIdByPhone в order-notify.ts): телефон заказа в виде
// +7…, совпавший с подтверждённым телефоном в bot_users, и бот не
// заблокирован. Поэтому подсказка «фото придёт / не придёт» всегда
// совпадает с тем, что случится при нажатии «Отправить клиенту».
// ================================================================

/**
 * Какие из телефонов подключены к боту. Возвращает набор телефонов в том
 * виде, в каком их передали; null — не удалось узнать (экран не роняем).
 */
export async function telegramLinkedPhones(phones: (string | null | undefined)[]): Promise<Set<string> | null> {
  const byE164 = new Map<string, string[]>();
  for (const raw of phones) {
    if (!raw) continue;
    const e164 = toE164RussianPhone(raw);
    if (!e164) continue;
    byE164.set(e164, [...(byE164.get(e164) ?? []), raw]);
  }
  const linked = new Set<string>();
  if (byE164.size === 0) return linked;

  const { data, error } = await getSupabaseAdmin()
    .from("bot_users")
    .select("phone")
    .eq("is_blocked", false)
    .in("phone", [...byE164.keys()]);
  if (error) {
    console.error("[bot-link] не удалось проверить подключение к боту:", error.message);
    return null;
  }
  for (const row of data ?? []) {
    for (const raw of byE164.get(row.phone as string) ?? []) linked.add(raw);
  }
  return linked;
}

/** Один телефон: true / false, null — не удалось узнать. */
export async function isTelegramLinked(phone: string | null | undefined): Promise<boolean | null> {
  if (!phone) return false;
  const set = await telegramLinkedPhones([phone]);
  return set ? set.has(phone) : null;
}
