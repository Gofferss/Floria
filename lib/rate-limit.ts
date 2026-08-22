// ================================================================
// Простое ограничение частоты запросов в памяти процесса.
//
// Границы применимости (важно понимать, чтобы не переоценивать):
//   - счётчики живут в памяти → сбрасываются при деплое/рестарте и не
//     общие, если когда-нибудь появится вторая копия приложения. Для
//     текущей схемы (один Node-процесс на VPS под Coolify) это работает;
//     при переезде на несколько инстансов нужен будет общий счётчик.
//   - IP берём из x-forwarded-for, который проставляет обратный прокси.
//     Заголовок в принципе подделываем, поэтому это защита от спама и
//     случайных циклов, а НЕ от целенаправленной распределённой атаки.
//
// Зачем вообще: /api/contact шлёт сообщение сотрудникам в Telegram, а
// /api/analytics/track пишет строку в БД — оба без авторизации, то есть
// без лимита любой желающий мог бы забить чат сотрудников или раздуть
// таблицу событий.
// ================================================================

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Чтобы Map не рос бесконечно от разовых посетителей — подчищаем
// просроченные записи при каждом N-м обращении (дешевле, чем таймер,
// и не мешает процессу завершиться).
let callsSinceSweep = 0;
const SWEEP_EVERY = 500;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * @param key      что именно ограничиваем — обычно `${название}:${ip}`
 * @param limit    сколько запросов разрешено в окне
 * @param windowMs длина окна в миллисекундах
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (++callsSinceSweep >= SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweep(now);
  }

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { allowed: true };
}

/**
 * IP клиента за обратным прокси. x-forwarded-for может содержать цепочку
 * "клиент, прокси1, прокси2" — берём первый элемент. Если заголовка нет
 * (прямое обращение), возвращаем "unknown": тогда все такие запросы
 * делят один счётчик, что для нас безопаснее, чем не ограничивать вовсе.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Единый ответ 429 с заголовком Retry-After. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "Слишком много запросов, попробуйте позже" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}
