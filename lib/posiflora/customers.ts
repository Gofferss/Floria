import { posifloraFetch } from "./http";
import { splitPhoneForPosiflora } from "./phone";

// ================================================================
// Posiflora Customers API
// https://posiflora.com/api/#tag/Customers-API
//
// ВАЖНАЯ ОГОВОРКА про поиск: у Posiflora нет отдельного эндпоинта
// "найти клиента по точному телефону" — есть GET /v1/customers?search=,
// который документация описывает как поиск "по имени, телефону или
// номеру бонусной карты" (то есть нечёткий, не гарантированно точный
// матч). Поэтому результат поиска здесь ВСЕГДА дополнительно сверяется
// по countryCode+phone — код никогда не берёт первый элемент списка
// вслепую. Также не до конца ясно из документации, в каком формате
// search ожидает номер (с кодом страны или без), поэтому пробуем оба
// варианта по очереди. Это защитный, а не "красивый" код — стоит
// подтвердить один раз вручную на реальном аккаунте, что поиск находит
// существующего клиента, прежде чем полагаться на него в проде.
// ================================================================

type PosifloraCustomerResource = {
  id: string;
  attributes?: {
    title?: string | null;
    phone?: string;
    countryCode?: number;
    currentPoints?: number;
  };
};

type MappedCustomer = {
  id: string;
  currentPoints: number;
};

function mapCustomerResource(resource: PosifloraCustomerResource): MappedCustomer {
  return {
    id: resource.id,
    currentPoints: resource.attributes?.currentPoints ?? 0,
  };
}

async function findByPhone(
  countryCode: number,
  localNumber: string
): Promise<PosifloraCustomerResource | null> {
  // Пробуем локальный номер и номер с кодом страны — см. оговорку выше.
  const searchAttempts = [localNumber, `${countryCode}${localNumber}`];

  for (const query of searchAttempts) {
    const json = (await posifloraFetch(`/customers?search=${encodeURIComponent(query)}`)) as {
      data?: PosifloraCustomerResource[];
    };

    const exactMatch = (json?.data ?? []).find(
      (c) => c.attributes?.countryCode === countryCode && c.attributes?.phone === localNumber
    );

    if (exactMatch) return exactMatch;
  }

  return null;
}

async function createCustomer(
  countryCode: number,
  localNumber: string,
  fullName?: string
): Promise<PosifloraCustomerResource> {
  const json = (await posifloraFetch("/customers", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "customers",
        attributes: {
          title: fullName?.trim() || "Клиент сайта",
          phone: localNumber,
          countryCode,
          isPerson: true,
          status: "on",
        },
      },
    }),
  })) as { data: PosifloraCustomerResource };

  return json.data;
}

// ================================================================
// Публичное API — сигнатуры 1-в-1 совпадают с прежним моком.
// lib/customer-sync.ts и app/api/orders/route.ts не трогали и не
// должны трогать: меняются только тела функций внутри этого модуля.
// ================================================================

export type FindOrCreatePosifloraClientInput = {
  phone: string;
  fullName?: string;
};

export type PosifloraClient = {
  posifloraClientId: string;
  bonusBalance: number;
  isNewClient: boolean;
};

/**
 * Ищет клиента по телефону; если не нашли — создаёт нового.
 * Задачи 1 (поиск) и 2 (создание) из архитектурного плана — в одной
 * функции, потому что вызывающему коду (customer-sync.ts) не важно,
 * какая из двух веток сработала, только итоговый ID и баланс.
 */
export async function findOrCreatePosifloraClient(
  input: FindOrCreatePosifloraClientInput
): Promise<PosifloraClient> {
  const { countryCode, localNumber } = splitPhoneForPosiflora(input.phone);

  const existing = await findByPhone(countryCode, localNumber);
  if (existing) {
    const mapped = mapCustomerResource(existing);
    return {
      posifloraClientId: mapped.id,
      bonusBalance: mapped.currentPoints,
      isNewClient: false,
    };
  }

  const created = await createCustomer(countryCode, localNumber, input.fullName);
  const mapped = mapCustomerResource(created);
  return {
    posifloraClientId: mapped.id,
    bonusBalance: mapped.currentPoints,
    isNewClient: true,
  };
}

/**
 * Только поиск, без создания — для бота: "узнать баланс" по чужому
 * непроверенному номеру не должно заводить в Posiflora карточку клиента.
 * Ищет и среди тех, кто оформлял на сайте, и среди тех, кого сотрудники
 * завели прямо в Posiflora при покупке в шоуруме (это разные множества —
 * наша таблица customers синхронизируется только в одну сторону, с сайта
 * в Posiflora, поэтому для "живого" вопроса баланса опрашиваем Posiflora
 * напрямую, а не локальный кэш).
 */
export async function findPosifloraClientByPhone(
  phone: string
): Promise<{ posifloraClientId: string; bonusBalance: number } | null> {
  const { countryCode, localNumber } = splitPhoneForPosiflora(phone);
  const found = await findByPhone(countryCode, localNumber);
  if (!found) return null;
  const mapped = mapCustomerResource(found);
  return { posifloraClientId: mapped.id, bonusBalance: mapped.currentPoints };
}

/**
 * Задача 3 — актуальный баланс бонусов. У Posiflora нет отдельного
 * "get balance" эндпоинта: currentPoints — обычное поле карточки
 * клиента (GET /v1/customers/{id}), баланс не отделён от остальных
 * данных клиента.
 */
export async function getPosifloraClientBalance(
  posifloraClientId: string
): Promise<{ bonusBalance: number }> {
  const json = (await posifloraFetch(`/customers/${posifloraClientId}`)) as {
    data: PosifloraCustomerResource;
  };
  return { bonusBalance: json.data.attributes?.currentPoints ?? 0 };
}
