import { getSupabaseAdmin } from "@/lib/supabase";
import { findOrCreatePosifloraClient, getPosifloraClientBalance } from "@/lib/posiflora";
import { requireE164RussianPhone } from "@/lib/phone-mask";

/** Баланс считается устаревшим и подлежит освежению через это время */
export const BONUS_SYNC_STALE_MS = 30 * 60 * 1000; // 30 минут

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : 0;
}

export type SyncedCustomer = {
  posifloraClientId: string;
  bonusBalance: number;
};

/**
 * Находит/создаёт клиента в Posiflora по телефону и записывает
 * posiflora_client_id + bonus_balance в customers. Бросает исключение при
 * сбое — вызывающий код сам решает, критично это здесь или нет (см.
 * linkAuthenticatedCustomerToPhone и resolveOrCreateCustomerByPhone ниже:
 * в обоих местах это best-effort шаг, не блокирующий основной сценарий).
 */
export async function syncCustomerWithPosiflora(
  customerId: string,
  phone: string,
  fullName?: string | null
): Promise<SyncedCustomer> {
  phone = requireE164RussianPhone(phone);

  const posifloraClient = await findOrCreatePosifloraClient({
    phone,
    fullName: fullName ?? undefined,
  });

  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("customers")
    .update({
      posiflora_client_id: posifloraClient.posifloraClientId,
      bonus_balance: posifloraClient.bonusBalance,
      bonus_balance_synced_at: new Date().toISOString(),
    })
    .eq("id", customerId);

  if (error) {
    // Тот же клиент Posiflora уже привязан к ДРУГОЙ строке customers —
    // значит, на одного человека у нас две карточки (исторически номер
    // хранился то с плюсом, то без, и .eq("phone", ...) считал их разными
    // людьми; теперь номер нормализуется на входе — см. lib/phone.ts).
    // Раньше здесь бросалось исключение, и кабинет уходил в бесконечный
    // цикл: каждая его загрузка заново дёргала Posiflora, падала на этом
    // же констрейнте и показывала 0 бонусов. Баланс мы уже получили —
    // отдаём его, а конфликт пишем в лог один раз, без падения.
    if (error.code === "23505") {
      console.error(
        `Клиент Posiflora ${posifloraClient.posifloraClientId} уже привязан к другой карточке; ` +
          `customers.id=${customerId} остаётся без связи. Нужно объединить дубли.`
      );
      return {
        posifloraClientId: posifloraClient.posifloraClientId,
        bonusBalance: posifloraClient.bonusBalance,
      };
    }

    throw new Error(`Не удалось записать синхронизацию с Posiflora: ${error.message}`);
  }

  return {
    posifloraClientId: posifloraClient.posifloraClientId,
    bonusBalance: posifloraClient.bonusBalance,
  };
}

export type ResolvedCustomer = {
  customerId: string | null;
  posifloraClientId: string | null;
  bonusBalance: number;
};

/**
 * Находит клиента по телефону в customers или создаёт нового (гостевой
 * чекаут — auth_user_id остаётся null). Заодно чинит связь заказов с
 * клиентом: раньше orders.customer_id никогда не заполнялся, теперь у
 * вызывающего кода (app/api/orders/route.ts) есть customerId для insert.
 *
 * Если Posiflora недоступна — карточка клиента в НАШЕЙ базе всё равно
 * создаётся/находится, просто без posiflora_client_id (bonusBalance = 0,
 * списание бонусов в этом заказе будет недоступно — безопаснее, чем
 * доверять непроверенному балансу).
 */
export async function resolveOrCreateCustomerByPhone(
  phone: string,
  fullName?: string
): Promise<ResolvedCustomer> {
  phone = requireE164RussianPhone(phone);

  const supabaseAdmin = getSupabaseAdmin();

  const { data: existing, error: selectError } = await supabaseAdmin
    .from("customers")
    .select("id, posiflora_client_id, bonus_balance, full_name")
    .eq("phone", phone)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Не удалось найти клиента по телефону: ${selectError.message}`);
  }

  if (existing) {
    let posifloraClientId = existing.posiflora_client_id as string | null;
    let bonusBalance = toNumber(existing.bonus_balance);

    // Гостевая карточка могла появиться раньше без синхронизации (например,
    // Posiflora была недоступна в прошлый раз) — подчищаем при случае.
    if (!posifloraClientId) {
      const synced = await trySync(existing.id, phone, fullName ?? existing.full_name);
      if (synced) {
        posifloraClientId = synced.posifloraClientId;
        bonusBalance = synced.bonusBalance;
      }
    }

    return { customerId: existing.id, posifloraClientId, bonusBalance };
  }

  const { data: created, error: insertError } = await supabaseAdmin
    .from("customers")
    .insert({ phone, full_name: fullName || null })
    .select("id")
    .single();

  if (insertError) {
    // Гонка: параллельный запрос успел создать карточку с этим же
    // телефоном на долю секунды раньше (например, двойной клик "Оплатить").
    // unique-констрейнт на phone — это код 23505 в Postgres.
    if (insertError.code === "23505") {
      const { data: raceWinner } = await supabaseAdmin
        .from("customers")
        .select("id, posiflora_client_id, bonus_balance")
        .eq("phone", phone)
        .maybeSingle();

      if (raceWinner) {
        return {
          customerId: raceWinner.id,
          posifloraClientId: raceWinner.posiflora_client_id,
          bonusBalance: toNumber(raceWinner.bonus_balance),
        };
      }
    }

    throw new Error(`Не удалось создать карточку клиента: ${insertError.message}`);
  }

  const synced = await trySync(created.id, phone, fullName);

  return {
    customerId: created.id,
    posifloraClientId: synced?.posifloraClientId ?? null,
    bonusBalance: synced?.bonusBalance ?? 0,
  };
}

async function trySync(
  customerId: string,
  phone: string,
  fullName?: string | null
): Promise<SyncedCustomer | null> {
  try {
    return await syncCustomerWithPosiflora(customerId, phone, fullName);
  } catch (error) {
    console.error("Posiflora недоступна при связывании клиента, продолжаем без нее:", error);
    return null;
  }
}

/**
 * Клиент вошёл через VK (у VK OAuth просто нет телефона в данных входа —
 * см. миграцию 006) и теперь сам вводит номер на /account. Два сценария:
 *
 *   1. Телефона с таким номером в customers ещё нет — просто дописываем
 *      его в уже существующую (созданную триггером при входе) карточку.
 *
 *   2. Телефон уже встречается — это гостевая карточка, оставшаяся от
 *      заказа, оформленного до входа через VK (там настоящая история
 *      заказов). Переносим auth_user_id на НЕЁ, а не наоборот — иначе
 *      история потеряется. Пустую карточку, которую создал вход через
 *      VK, не удаляем (риск каскадных последствий для чужого кода в
 *      будущем не стоит той минимальной уборки) — просто отвязываем от
 *      аккаунта, обнуляя auth_user_id: она станет неактивным сиротским
 *      рядом без всякого значения, но безопасно.
 *
 * Синхронизация с Posiflora — best effort, как и везде в этом модуле.
 */
export async function linkAuthenticatedCustomerToPhone(
  authUserId: string,
  phone: string,
  fullName?: string | null
): Promise<ResolvedCustomer> {
  phone = requireE164RussianPhone(phone);

  const supabaseAdmin = getSupabaseAdmin();

  const { data: myCustomer, error: myError } = await supabaseAdmin
    .from("customers")
    .select("id, full_name")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (myError || !myCustomer) {
    throw new Error(
      `Не найдена карточка клиента для auth_user_id=${authUserId}: ${myError?.message ?? "нет строки"}`
    );
  }

  const { data: existingByPhone, error: phoneError } = await supabaseAdmin
    .from("customers")
    .select("id, full_name")
    .eq("phone", phone)
    .neq("id", myCustomer.id)
    .maybeSingle();

  if (phoneError) {
    throw new Error(`Не удалось проверить телефон на дубли: ${phoneError.message}`);
  }

  let targetCustomerId = myCustomer.id;
  const targetFullName = fullName ?? myCustomer.full_name ?? null;

  if (existingByPhone) {
    // Сценарий 2 — сливаем на существующую (гостевую) карточку.
    const { error: relinkError } = await supabaseAdmin
      .from("customers")
      .update({ auth_user_id: authUserId })
      .eq("id", existingByPhone.id);

    if (relinkError) {
      throw new Error(`Не удалось перепривязать гостевую карточку: ${relinkError.message}`);
    }

    await supabaseAdmin.from("customers").update({ auth_user_id: null }).eq("id", myCustomer.id);

    targetCustomerId = existingByPhone.id;
  } else {
    // Сценарий 1 — просто дописываем телефон в свою карточку.
    const { error: updateError } = await supabaseAdmin
      .from("customers")
      .update({ phone })
      .eq("id", myCustomer.id);

    if (updateError) {
      throw new Error(`Не удалось сохранить телефон: ${updateError.message}`);
    }
  }

  const synced = await trySync(targetCustomerId, phone, targetFullName);

  return {
    customerId: targetCustomerId,
    posifloraClientId: synced?.posifloraClientId ?? null,
    bonusBalance: synced?.bonusBalance ?? 0,
  };
}

/**
 * Освежает кэш баланса бонусов из Posiflora — используется на /account,
 * когда bonus_balance_synced_at устарел. Никогда не бросает исключение:
 * страница личного кабинета не должна падать из-за недоступности CRM,
 * в худшем случае просто покажет чуть менее свежий баланс.
 */
export async function refreshCustomerBonusBalance(
  customerId: string,
  posifloraClientId: string
): Promise<number | null> {
  try {
    const { bonusBalance } = await getPosifloraClientBalance(posifloraClientId);

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("customers")
      .update({ bonus_balance: bonusBalance, bonus_balance_synced_at: new Date().toISOString() })
      .eq("id", customerId);

    if (error) {
      console.error("Не удалось обновить кэш баланса бонусов:", error);
      return null;
    }

    return bonusBalance;
  } catch (error) {
    console.error("Ошибка обновления баланса из Posiflora:", error);
    return null;
  }
}
