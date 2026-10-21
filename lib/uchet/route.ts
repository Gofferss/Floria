// ================================================================
// Маршруты курьеров — арифметика без базы и без интерфейса.
//
// Задача не «идеальный маршрут», а разумный и объяснимый за секунды:
//   * раскладка по курьерам — «веером» от студии: город делится на
//     сектора так, чтобы у каждого курьера было поровну доставок, и
//     соседние адреса попадали к одному человеку;
//   * порядок объезда — сначала по окнам времени (10–12 раньше 15–17),
//     внутри одного окна — к ближайшему следующему адресу;
//   * доставки «в течение дня» вставляются туда, где дают меньше крюка.
// Расстояния — по прямой: внутри города для порядка объезда этого хватает,
// а дорогу ведёт Яндекс Навигатор.
// ================================================================

export type Point = { lat: number; lon: number };

export type RouteStop = {
  key: string;
  point: Point | null;
  /** Начало окна «с», «HH:MM»; null — в течение дня. */
  from: string | null;
};

const R = 6371;

export function distanceKm(a: Point, b: Point): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function angleFrom(start: Point, p: Point): number {
  // Долготу ужимаем на косинус широты, иначе сектора на юге города
  // получались бы вытянутыми.
  return Math.atan2(p.lat - start.lat, (p.lon - start.lon) * Math.cos((start.lat * Math.PI) / 180));
}

/**
 * Раскладка по курьерам «веером». Сектора начинаются с самого широкого
 * пустого промежутка между адресами — чтобы не разрезать плотную кучку
 * соседних домов между двумя курьерами. Адреса без точки на карте
 * отдаются тем, у кого меньше доставок.
 */
export function splitByCouriers<T extends RouteStop>(stops: T[], couriers: string[], start: Point): Map<string, string> {
  const result = new Map<string, string>();
  if (couriers.length === 0) return result;
  if (couriers.length === 1) {
    for (const s of stops) result.set(s.key, couriers[0]);
    return result;
  }

  const located = stops.filter((s) => s.point).map((s) => ({ s, a: angleFrom(start, s.point!) }));
  const unlocated = stops.filter((s) => !s.point);
  located.sort((x, y) => x.a - y.a);

  // Самый широкий промежуток между соседними углами — оттуда и режем.
  let cut = 0;
  let widest = -1;
  for (let i = 0; i < located.length; i++) {
    const cur = located[i].a;
    const next = i + 1 < located.length ? located[i + 1].a : located[0].a + 2 * Math.PI;
    if (next - cur > widest) {
      widest = next - cur;
      cut = (i + 1) % located.length;
    }
  }
  const ring = [...located.slice(cut), ...located.slice(0, cut)];

  // Доли — поровну, лишние по одному первым: 40 на троих — 14, 13, 13.
  const load = new Map(couriers.map((c) => [c, 0]));
  const base = Math.floor(ring.length / couriers.length);
  const extra = ring.length % couriers.length;
  const target = (i: number) => base + (i < extra ? 1 : 0);
  let c = 0;
  for (const { s } of ring) {
    while (c < couriers.length - 1 && (load.get(couriers[c]) ?? 0) >= target(c)) c++;
    result.set(s.key, couriers[c]);
    load.set(couriers[c], (load.get(couriers[c]) ?? 0) + 1);
  }
  for (const s of unlocated) {
    const lightest = [...load.entries()].sort((x, y) => x[1] - y[1])[0][0];
    result.set(s.key, lightest);
    load.set(lightest, (load.get(lightest) ?? 0) + 1);
  }
  return result;
}

/** Сколько добавит к пути остановка p, вставленная между a и b. */
function detour(a: Point | null, p: Point, b: Point | null): number {
  const ap = a ? distanceKm(a, p) : 0;
  const pb = b ? distanceKm(p, b) : 0;
  const ab = a && b ? distanceKm(a, b) : 0;
  return ap + pb - ab;
}

/**
 * Порядок объезда для одного курьера. Начало — студия (или где курьер
 * сейчас). Окна времени идут по порядку; внутри окна — ближайший адрес
 * от предыдущего. «В течение дня» — вставкой с наименьшим крюком.
 */
export function orderRoute<T extends RouteStop>(stops: T[], start: Point | null): T[] {
  const timed = stops.filter((s) => s.from);
  const untimed = stops.filter((s) => !s.from);

  const windows = [...new Set(timed.map((s) => s.from as string))].sort();
  const route: T[] = [];
  let cur = start;

  for (const w of windows) {
    const pool = timed.filter((s) => s.from === w);
    const located = pool.filter((s) => s.point);
    while (located.length) {
      let best = 0;
      if (cur) {
        let bestD = Infinity;
        located.forEach((s, i) => {
          const d = distanceKm(cur as Point, s.point as Point);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
      }
      const [next] = located.splice(best, 1);
      route.push(next);
      cur = next.point;
    }
    // Без точки на карте — в конце своего окна: время важнее расстояния.
    route.push(...pool.filter((s) => !s.point));
  }

  for (const s of untimed) {
    if (!s.point) {
      route.push(s);
      continue;
    }
    let bestAt = route.length;
    let bestD = Infinity;
    for (let i = 0; i <= route.length; i++) {
      const before = i === 0 ? start : route[i - 1].point;
      const after = i < route.length ? route[i].point : null;
      const d = detour(before, s.point, after);
      if (d < bestD) {
        bestD = d;
        bestAt = i;
      }
    }
    route.splice(bestAt, 0, s);
  }
  return route;
}

/** Длина пути по прямой — чтобы показать, сколько примерно ехать. */
export function routeLengthKm(start: Point | null, points: (Point | null)[]): number {
  let total = 0;
  let cur = start;
  for (const p of points) {
    if (!p) continue;
    if (cur) total += distanceKm(cur, p);
    cur = p;
  }
  return total;
}

const fmt = (p: Point) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

/**
 * Ссылки на маршрут в Яндекс Картах: точки через «~», сначала широта
 * (формат из документации Яндекса). Сколько точек принимает одна ссылка,
 * Яндекс не пишет, поэтому длинный маршрут режем на куски — каждый
 * следующий начинается там, где закончился предыдущий. Без начальной
 * точки маршрут строится от места, где сейчас телефон.
 */
export function yandexRouteLinks(start: Point | null, points: Point[], perLink = 9): { url: string; from: number; to: number }[] {
  const links: { url: string; from: number; to: number }[] = [];
  for (let i = 0; i < points.length; i += perLink) {
    const chunk = points.slice(i, i + perLink);
    const origin = i === 0 ? start : points[i - 1];
    const rtext = `${origin ? fmt(origin) : ""}~${chunk.map(fmt).join("~")}`;
    links.push({ url: `https://yandex.ru/maps/?rtext=${rtext}&rtt=auto`, from: i + 1, to: i + chunk.length });
  }
  return links;
}

/** Одна точка — «как доехать» от текущего места. */
export function yandexPointRoute(p: Point): string {
  return `https://yandex.ru/maps/?rtext=~${fmt(p)}&rtt=auto`;
}
