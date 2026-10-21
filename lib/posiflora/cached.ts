import { posifloraFetch } from "./http";

// ================================================================
// Чтение Posiflora с кэшем в памяти процесса — для отчётов (сводка,
// зарплата). Один и тот же отчёт за прошлый месяц не меняется, и нет
// смысла спрашивать его на каждое открытие страницы. Ошибки не
// кэшируются: следующее открытие спросит снова.
//
// Только GET: из отчётов в Posiflora ничего не пишется.
// ================================================================

export type JsonApiRow = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string } | null }>;
};

export type JsonApi = {
  data?: JsonApiRow[] | { attributes?: Record<string, unknown> };
  meta?: Record<string, unknown>;
  included?: { id: string; type: string; attributes?: Record<string, unknown> }[];
};

export const MINUTE = 60_000;

const cache = new Map<string, { at: number; ttl: number; value: JsonApi }>();

export async function posifloraCached(path: string, ttl: number): Promise<JsonApi> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const value = (await posifloraFetch(path, { headers: { Accept: "application/vnd.api+json" } })) as JsonApi;
  if (cache.size > 400) cache.clear();
  cache.set(path, { at: Date.now(), ttl, value });
  return value;
}

/** Строки ответа списком (у отчёта-итога data — объект, тогда пусто). */
export function jsonRows(res: JsonApi): JsonApiRow[] {
  return Array.isArray(res.data) ? res.data : [];
}

/** Фильтр периода отчётов Posiflora. Даты — только «Y-m-d», метку времени она не принимает. */
export const posifloraRange = (from: string, to: string) => `filter[range]=custom&filter[rangeFrom]=${from}&filter[rangeTo]=${to}`;
