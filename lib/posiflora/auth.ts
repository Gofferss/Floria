// ================================================================
// Сессия Posiflora API.
//
// В отличие от статичного API-ключа, Posiflora использует логин по
// username+password (POST /v1/sessions), который отдаёт короткоживущий
// accessToken (~1 час, JWT) и refreshToken (~30 дней). См.
// https://posiflora.com/api/#tag/Auth-API
//
// Кэш — в памяти процесса. Подходит для постоянно работающего Node-
// процесса (Coolify на Timeweb Cloud, как у нас) — НЕ подходит "из
// коробки" для serverless с холодным стартом на каждый вызов, там
// каждый инстанс логинился бы заново.
// ================================================================

type PosifloraSession = {
  accessToken: string;
  refreshToken: string;
  expireAt: number; // ms epoch
  refreshExpireAt: number; // ms epoch
};

let cachedSession: PosifloraSession | null = null;
// Пока идёт логин/рефреш — параллельные вызовы ждут ЭТОТ же промис,
// а не плодят по отдельному запросу сессии на каждый.
let pendingLogin: Promise<PosifloraSession> | null = null;

// Обновляем чуть заранее, не впритык к истечению — иначе запрос,
// стартовавший за секунду до истечения токена, долетит до Posiflora
// уже с просроченным accessToken.
const REFRESH_MARGIN_MS = 60_000;

export function getPosifloraBaseUrl(): string {
  const url = process.env.POSIFLORA_API_URL;
  if (!url) {
    throw new Error("POSIFLORA_API_URL не задан в переменных окружения");
  }
  return url.replace(/\/+$/, "");
}

function parseSessionResponse(json: unknown): PosifloraSession {
  const attrs = (json as { data?: { attributes?: Record<string, unknown> } })?.data?.attributes;
  const { accessToken, refreshToken, expireAt, refreshExpireAt } = attrs ?? {};

  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expireAt !== "string" ||
    typeof refreshExpireAt !== "string"
  ) {
    throw new Error("Posiflora: неожиданный формат ответа сессии");
  }

  return {
    accessToken,
    refreshToken,
    expireAt: new Date(expireAt).getTime(),
    refreshExpireAt: new Date(refreshExpireAt).getTime(),
  };
}

async function loginWithCredentials(): Promise<PosifloraSession> {
  const username = process.env.POSIFLORA_USERNAME;
  const password = process.env.POSIFLORA_PASSWORD;
  if (!username || !password) {
    throw new Error("POSIFLORA_USERNAME / POSIFLORA_PASSWORD не заданы в переменных окружения");
  }

  const response = await fetch(`${getPosifloraBaseUrl()}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/vnd.api+json" },
    body: JSON.stringify({
      data: { type: "sessions", attributes: { username, password } },
    }),
  });

  if (!response.ok) {
    throw new Error(`Posiflora: не удалось войти (${response.status})`);
  }

  return parseSessionResponse(await response.json());
}

async function refreshWithToken(refreshToken: string): Promise<PosifloraSession> {
  const response = await fetch(`${getPosifloraBaseUrl()}/sessions`, {
    method: "PATCH",
    headers: { "Content-Type": "application/vnd.api+json" },
    body: JSON.stringify({
      data: { type: "sessions", attributes: { refreshToken } },
    }),
  });

  if (!response.ok) {
    throw new Error(`Posiflora: не удалось обновить сессию (${response.status})`);
  }

  return parseSessionResponse(await response.json());
}

/**
 * Возвращает валидный access-токен: из кэша → через refresh → через
 * новый логин, в порядке возрастания стоимости операции. Параллельные
 * вызовы во время логина/рефреша дожидаются один общий промис.
 */
export async function getPosifloraAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedSession && cachedSession.expireAt - REFRESH_MARGIN_MS > now) {
    return cachedSession.accessToken;
  }

  if (pendingLogin) {
    const session = await pendingLogin;
    return session.accessToken;
  }

  if (cachedSession && cachedSession.refreshExpireAt - REFRESH_MARGIN_MS > now) {
    try {
      pendingLogin = refreshWithToken(cachedSession.refreshToken);
      cachedSession = await pendingLogin;
      return cachedSession.accessToken;
    } catch (error) {
      console.error("Posiflora: обновление сессии не удалось, логинимся заново:", error);
      cachedSession = null;
    } finally {
      pendingLogin = null;
    }
  }

  try {
    pendingLogin = loginWithCredentials();
    cachedSession = await pendingLogin;
    return cachedSession.accessToken;
  } finally {
    pendingLogin = null;
  }
}

/** Сбрасывает кэш сессии — например, после неожиданного 401 от API. */
export function invalidatePosifloraSession(): void {
  cachedSession = null;
}
