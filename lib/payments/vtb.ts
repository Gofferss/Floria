// ================================================================
// Клиент платёжного шлюза ВТБ.
//
// Две вещи, которые стоили полдня и которые нельзя забыть.
//
// 1. Сертификат ВТБ подписан удостоверяющим центром Минцифры, которого нет
//    ни в одном стандартном хранилище доверия. Без certs/russian-trusted-ca.pem
//    и переменной NODE_EXTRA_CA_CERTS любой запрос сюда падает с безликим
//    "fetch failed", за которым прячется UNABLE_TO_GET_ISSUER_CERT_LOCALLY.
//    См. certs/README.md.
//
// 2. Токен живёт 179 СЕКУНД. Это не опечатка. Поэтому он кэшируется в памяти
//    процесса и обновляется заранее, с запасом: получать новый токен на
//    каждый запрос — лишняя пара секунд и лишняя точка отказа ровно в тот
//    момент, когда человек нажал "оплатить".
//
// Про доверие к ответам. Уведомления шлюза (callback) НЕ подписаны — ни
// HMAC, ни контрольной суммы, ни белого списка адресов в документации нет.
// Поэтому единственным источником правды о том, оплачен ли заказ, служит
// getPaymentOrder() — запрос, который делаем МЫ, со своими ключами.
// Подробнее — в обработчике уведомлений.
// ================================================================

type TokenResponse = { access_token: string; expires_in: number; token_type: string };

/** Токен и момент, после которого его пора обновить. */
let cachedToken: { value: string; expiresAt: number } | null = null;

// Обновляем за 30 секунд до истечения: при жизни в 179 секунд это заметный
// запас, но не настолько большой, чтобы дёргать банк почти на каждый запрос.
const TOKEN_REFRESH_MARGIN_MS = 30_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} не задан в переменных окружения`);
  return value;
}

/**
 * Значение заголовка X-IBM-Client-Id — это client_id БЕЗ домена и в нижнем
 * регистре (требование раздела 4.16.2 инструкции). Выводим его из client_id,
 * а не заводим отдельную переменную: две переменные, которые обязаны
 * совпадать, рано или поздно разъедутся.
 */
function ibmClientId(clientId: string): string {
  return clientId.split("@")[0].toLowerCase();
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt) return cachedToken.value;

  const clientId = requireEnv("VTB_CLIENT_ID");
  const clientSecret = requireEnv("VTB_CLIENT_SECRET");
  const tokenUrl = requireEnv("VTB_TOKEN_URL");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ВТБ: не выдал токен (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as TokenResponse;
  if (!data.access_token) throw new Error("ВТБ: в ответе нет access_token");

  const lifetimeMs = (data.expires_in ?? 179) * 1000;
  cachedToken = {
    value: data.access_token,
    expiresAt: now + Math.max(lifetimeMs - TOKEN_REFRESH_MARGIN_MS, 10_000),
  };

  return cachedToken.value;
}

async function vtbFetch(path: string, init: { method: string; body?: unknown }): Promise<unknown> {
  const token = await getAccessToken();
  const clientId = requireEnv("VTB_CLIENT_ID");
  const apiBase = requireEnv("VTB_API_BASE").replace(/\/+$/, "");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-IBM-Client-Id": ibmClientId(clientId),
    "Content-Type": "application/json",
  };

  // Заголовок обязателен только если у мерчанта больше одного ресурса, но
  // передавать его безвредно и всегда — а вот забыть при подключении второго
  // сайта было бы неприятно.
  const merchantAuth = process.env.VTB_MERCHANT_AUTH;
  if (merchantAuth) headers["Merchant-Authorization"] = merchantAuth;

  const response = await fetch(`${apiBase}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ВТБ ${init.method} ${path}: HTTP ${response.status} ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`ВТБ ${init.method} ${path}: ответ не JSON: ${text.slice(0, 200)}`);
  }
}

export type PaymentBasketItem = {
  name: string;
  quantity: number;
  /** Цена за единицу в рублях. */
  price: number;
};

export type CreatePaymentInput = {
  /** Наш номер заказа. Запрос идемпотентный: повтор с тем же значением вернёт уже созданный ордер. */
  orderId: string;
  orderName: string;
  amount: number;
  customerEmail: string | null;
  customerPhone: string;
  /** Куда вернуть человека с платёжной формы. */
  returnUrl: string;
  items: PaymentBasketItem[];
  /** Сколько минут жить ссылке на оплату. */
  lifetimeMinutes?: number;
};

export type CreatePaymentResult = {
  /** Внешний идентификатор ордера в ВТБ. */
  orderCode: string;
  /** Ссылка на платёжную форму (карты). */
  payUrl: string;
  /** Ссылка на оплату через СБП, если шлюз её вернул. */
  sbpUrl: string | null;
  expire: string;
};

/** Телефон для ВТБ — только цифры, в формате 79009990099. */
function phoneForVtb(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
}

/** Сумма с двумя знаками: шлюз ждёт число вида 1055.20, а не 1055.2000000001. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function createPaymentOrder(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  const lifetime = input.lifetimeMinutes ?? 30;
  // Формат ВТБ: ровно три знака миллисекунд и зона Z. toISOString() уже даёт
  // именно такой вид, но подстраховываемся от неожиданностей рантайма.
  const expire = new Date(Date.now() + lifetime * 60_000)
    .toISOString()
    .replace(/\.(\d{3})\d*Z$/, ".$1Z");

  const body: Record<string, unknown> = {
    orderId: input.orderId,
    orderName: input.orderName.slice(0, 255),
    expire,
    // Просим шлюз вернуть данные для СБП вдобавок к платёжной форме.
    returnPaymentData: "sbp",
    amount: { value: money(input.amount), code: "RUB" },
    returnUrl: input.returnUrl,
    customer: {
      customerId: input.orderId,
      phone: phoneForVtb(input.customerPhone),
      ...(input.customerEmail ? { email: input.customerEmail } : {}),
    },
  };

  // Товарная корзина нужна для фискального чека (54-ФЗ). Без email покупателя
  // ОФД отправит чек на адрес из настроек мерчанта — чек будет выбит в любом
  // случае, но клиент его не увидит.
  if (input.customerEmail) {
    body.bundle = {
      fiscalInfo: { clientEmail: input.customerEmail },
      items: input.items.map((item, index) => ({
        positionId: index + 1,
        name: item.name.slice(0, 128),
        price: { value: money(item.price), code: "RUB" },
        quantity: item.quantity,
        amount: { value: money(item.price * item.quantity), code: "RUB" },
      })),
    };
  }

  const raw = (await vtbFetch("/v1/orders", { method: "POST", body })) as {
    object?: {
      orderCode?: string;
      payUrl?: string;
      expire?: string;
      preparedPayments?: Array<{ type?: string; object?: { url?: string } }>;
    };
  };

  const object = raw.object;
  if (!object?.payUrl) throw new Error("ВТБ: в ответе нет payUrl");

  const sbp = object.preparedPayments?.find((p) => p.type === "sbp");

  return {
    orderCode: object.orderCode ?? "",
    payUrl: object.payUrl,
    sbpUrl: sbp?.object?.url ?? null,
    expire: object.expire ?? expire,
  };
}

export type PaymentOrderState = {
  status: string;
  amount: number;
  changedAt: string | null;
};

/**
 * Состояние ордера ПО ВЕРСИИ ШЛЮЗА — единственный источник правды об оплате.
 * Именно этот запрос, а не содержимое уведомления, решает, считать ли заказ
 * оплаченным: уведомления не подписаны и подделываются кем угодно.
 */
export async function getPaymentOrder(orderId: string): Promise<PaymentOrderState> {
  const raw = (await vtbFetch(`/v1/orders/${encodeURIComponent(orderId)}`, { method: "GET" })) as {
    object?: {
      status?: { value?: string; changedAt?: string };
      amount?: { value?: number };
    };
  };

  const object = raw.object;
  return {
    status: object?.status?.value ?? "UNKNOWN",
    amount: object?.amount?.value ?? 0,
    changedAt: object?.status?.changedAt ?? null,
  };
}

/** Статусы ордера ВТБ, означающие "деньги получены". */
export const PAID_STATUSES = new Set(["PAID"]);

/** Статусы, после которых оплата уже не случится и ссылку можно не хранить. */
export const DEAD_STATUSES = new Set(["EXPIRED", "CANCELED"]);
