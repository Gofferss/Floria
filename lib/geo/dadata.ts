import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Адреса через DaData: подсказки при вводе и координаты для маршрутов.
//
// Ключ — DADATA_API_KEY в переменных Coolify (API-ключ, не секретный).
// Нет ключа — подсказок и координат нет, но ничего не ломается: экраны
// честно говорят, что адреса не на карте, и маршрут строится по времени.
//
// Бесплатно 10 000 запросов в день на все подсказки. Координаты DaData
// отдаёт только на запрос с count = 1 («человек выбрал адрес»), поэтому
// для перевода адреса в точку спрашиваем ровно так. Ответы кэшируются в
// geo_cache — один адрес не спрашиваем дважды.
//
// В DaData уходит только адрес. Имена и телефоны остаются у нас.
// ================================================================

const SUGGEST_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address";
const TIMEOUT_MS = 4000;

/** Ищем в Крыму: доставки бывают и за город. */
const LOCATIONS = [{ region: "Крым" }];

export type GeoPoint = { lat: number; lon: number; quality: number; fullAddress: string };
export type AddressSuggestion = { value: string };

export function hasDadataKey(): boolean {
  return !!process.env.DADATA_API_KEY?.trim();
}

async function ask(query: string, count: number): Promise<{ value: string; data: { geo_lat: string | null; geo_lon: string | null; qc_geo: string | null } }[] | null> {
  const key = process.env.DADATA_API_KEY?.trim();
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SUGGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Token ${key}` },
      body: JSON.stringify({ query: query.slice(0, 300), count, locations: LOCATIONS }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[dadata] ответ", res.status);
      return null;
    }
    const json = (await res.json()) as { suggestions?: { value: string; data: { geo_lat: string | null; geo_lon: string | null; qc_geo: string | null } }[] };
    return json.suggestions ?? [];
  } catch (error) {
    console.error("[dadata] запрос не прошёл:", (error as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Подсказки при вводе адреса — без координат, они придут при выборе. */
export async function suggestAddresses(query: string): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const list = await ask(q, 6);
  return (list ?? []).map((s) => ({ value: s.value }));
}

const normalize = (address: string) => address.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Адрес → точка на карте. Сначала кэш, потом DaData. null — ключа нет,
 * сервис недоступен или адрес не нашёлся (тогда это тоже запоминаем, чтобы
 * не спрашивать снова каждый раз).
 */
export async function geocode(address: string): Promise<GeoPoint | null> {
  const query = normalize(address);
  if (!query) return null;
  const admin = getSupabaseAdmin();

  const { data: cached } = await admin.from("geo_cache").select("lat, lon, quality, full_address").eq("query", query).maybeSingle();
  if (cached) {
    if (cached.lat === null || cached.lon === null) return null;
    return { lat: Number(cached.lat), lon: Number(cached.lon), quality: cached.quality ?? 5, fullAddress: cached.full_address ?? address };
  }

  const list = await ask(address, 1);
  // Сбой связи или нет ключа — не кэшируем: в следующий раз спросим снова.
  if (list === null) return null;

  const top = list[0];
  const lat = top?.data.geo_lat ? Number(top.data.geo_lat) : null;
  const lon = top?.data.geo_lon ? Number(top.data.geo_lon) : null;
  const quality = top?.data.qc_geo !== null && top?.data.qc_geo !== undefined ? Number(top.data.qc_geo) : 5;

  await admin.from("geo_cache").upsert({ query, lat, lon, quality, full_address: top?.value ?? null, fetched_at: new Date().toISOString() });

  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, quality, fullAddress: top.value };
}
