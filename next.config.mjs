/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === "development";

// ================================================================
// Заголовки безопасности. Раньше не было ни одного — браузер не получал
// никаких ограничений сверх дефолтных.
//
// Про script-src честно: в App Router Next.js встраивает инлайн-скрипты
// с данными гидрации, поэтому без 'unsafe-inline' сайт просто не
// запустится, а nonce потребовал бы middleware и убил бы статическую
// генерацию страниц. Поэтому CSP здесь — не защита от инлайн-XSS
// (её роль выполняет санитизация контента блога, lib/sanitize-html.ts),
// а защита от ПОДГРУЗКИ чужих скриптов, кликджекинга, подмены <base>
// и утечки referrer. В dev дополнительно нужен 'unsafe-eval' — на нём
// работает горячая перезагрузка.
// ================================================================
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Картинки товаров лежат в Supabase Storage; data:/blob: нужны
  // next/image и предпросмотру загружаемых файлов в админке.
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  // Supabase Auth/PostgREST дергается прямо из браузера анонимным ключом.
  "connect-src 'self' https://*.supabase.co",
  // Виджет Яндекс.Карт на /contacts.
  "frame-src https://yandex.ru https://*.yandex.ru",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Дублирует frame-ancestors выше — для браузеров, не понимающих CSP.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig = {
  // Не сообщаем каждому запросу, на чём собран сайт: знание версии
  // фреймворка экономит время тому, кто подбирает известные уязвимости.
  poweredByHeader: false,

  experimental: {
    serverActions: {
      // Умолчание Next — 1 МБ на тело серверного действия, и любое фото с
      // телефона в него не влезало. Запрос отклонялся ДО того, как код
      // добирался до собственной проверки размера, поэтому в админке не
      // грузился даже обычный JPEG — что и выглядело как «формат не тот».
      //
      // 8 МБ с запасом: браузер теперь ужимает снимок перед отправкой
      // (lib/prepare-image.ts, обычно выходит 300–600 КБ), так что предел
      // работает страховкой на случай, если сжатие не сработало.
      bodySizeLimit: "8mb",
    },
  },

  images: {
    remotePatterns: [
      {
        // Обложки блога из bucket blog-images (миграция 008). Wildcard
        // вместо конкретного project ref — работает для любого проекта
        // Supabase без правки при смене окружения (dev/prod).
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          // HSTS только для прода: в dev сайт открыт по http://localhost,
          // и включённый HSTS заставил бы браузер упорно ходить на https.
          ...(isDev
            ? []
            : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
