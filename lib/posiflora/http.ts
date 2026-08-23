import {
  getPosifloraAccessToken,
  getPosifloraBaseUrl,
  invalidatePosifloraSession,
  POSIFLORA_TIMEOUT_MS,
} from "./auth";


/**
 * Аутентифицированный запрос к Posiflora API. При 401 сбрасывает кэш
 * сессии и повторяет ОДИН раз — на случай, если токен был отозван на
 * стороне Posiflora раньше, чем истёк срок по нашим часам (админ вручную
 * завершил сессию, рассинхрон часов и т.п.).
 */
export async function posifloraFetch(
  path: string,
  init: RequestInit = {},
  retryOn401 = true
): Promise<unknown> {
  const accessToken = await getPosifloraAccessToken();

  const response = await fetch(`${getPosifloraBaseUrl()}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(POSIFLORA_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });

  if (response.status === 401 && retryOn401) {
    invalidatePosifloraSession();
    return posifloraFetch(path, init, false);
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
