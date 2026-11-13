import {
  getPosifloraAccessToken,
  getPosifloraBaseUrl,
  invalidatePosifloraSession,
  POSIFLORA_TIMEOUT_MS,
} from "./auth";

// ================================================================
// Вход в Posiflora: ключ API или логин с паролем.
//
// С ноября 2026 Posiflora выдаёт ключи интеграций (админка → «Настройки» →
// «API-ключи»): ключ передаётся в заголовке X-Api-Key, токены получать и
// обновлять не нужно. Если в окружении есть POSIFLORA_API_KEY — работаем
// по нему. Иначе — по-старому, логином и паролем (POSIFLORA_USERNAME /
// POSIFLORA_PASSWORD), чтобы ничего не встало, пока ключ не вписан.
//
// Ключ не принят (отозван, опечатка) — НЕ откатываемся молча на пароль:
// такой сбой должен быть виден. Ошибка уходит в синхронизацию каталога,
// а та после нескольких сбоев подряд сообщает в Telegram (health-report).
// ================================================================

function apiKey(): string | null {
  const key = process.env.POSIFLORA_API_KEY?.trim();
  return key ? key : null;
}

/** Каким способом входим — для журнала и проверок, без самого ключа. */
export function posifloraAuthMode(): "api-key" | "password" {
  return apiKey() ? "api-key" : "password";
}

async function authHeaders(): Promise<Record<string, string>> {
  const key = apiKey();
  if (key) return { "X-Api-Key": key };
  return { Authorization: `Bearer ${await getPosifloraAccessToken()}` };
}

/**
 * Аутентифицированный запрос к Posiflora API. При входе по паролю на 401
 * сбрасывает кэш сессии и повторяет ОДИН раз — на случай, если токен был
 * отозван на стороне Posiflora раньше, чем истёк срок по нашим часам.
 */
export async function posifloraFetch(
  path: string,
  init: RequestInit = {},
  retryOn401 = true
): Promise<unknown> {
  const response = await fetch(`${getPosifloraBaseUrl()}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(POSIFLORA_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
      ...(await authHeaders()),
      ...init.headers,
    },
  });

  if (response.status === 401) {
    if (apiKey()) {
      throw new Error(
        "Posiflora не приняла ключ API (401) — ключ отозван или вписан с ошибкой. " +
          "Проверьте POSIFLORA_API_KEY в Coolify или выпустите новый ключ в Posiflora."
      );
    }
    if (retryOn401) {
      invalidatePosifloraSession();
      return posifloraFetch(path, init, false);
    }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Posiflora ${init.method ?? "GET"} ${path} → ${response.status}: ${body.slice(0, 500)}`
    );
  }

  if (response.status === 204) return null;
  return response.json();
}
