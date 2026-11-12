/* ================================================================
 * Флория Учёт без интернета — помощник браузера (service worker).
 *
 * Зачем. Без связи учёт раньше работал, только пока страница уже открыта.
 * Но айпад сам перезагружает вкладку, которую давно не трогали; приложение
 * с экрана «Домой» перезапускается; при переходе в другой раздел Next.js без
 * связи делает полную загрузку страницы — и вместо кассы белый экран «нет
 * сети». Здесь хранятся копии экранов учёта и файлы программы, и без связи
 * отдаются они.
 *
 * Что как:
 *  - экраны учёта: сначала сеть; нет ответа за 6 с или нет сети — копия;
 *  - файлы программы (/_next/static): один раз скачали — дальше с айпада,
 *    они не меняются (у новой версии новые имена);
 *  - фото товаров: с айпада, а в фоне — свежая копия;
 *  - всё остальное (запросы действий, продажи) — как обычно, мимо. Продажа
 *    без связи по-прежнему ложится в очередь кассы (kassa/outbox.ts).
 *  - «прогрев»: страница раз в полчаса просит сохранить все разделы меню,
 *    чтобы без связи открывался и раздел, куда сегодня ещё не заходили.
 *
 * Работает только внутри своей области (регистрация со scope "/uchet");
 * публичный сайт он не трогает. Выход из учётной записи стирает копии
 * экранов (в них данные), но не очередь продаж.
 * ================================================================ */

const VERSION = "v1";
const PAGES = `uchet-pages-${VERSION}`;
const STATIC = `uchet-static-${VERSION}`;
const IMAGES = `uchet-images-${VERSION}`;
const STATIC_MAX = 900;
const IMAGES_MAX = 400;
const NAV_TIMEOUT_MS = 6000;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, STATIC, IMAGES]);
      for (const key of await caches.keys()) {
        if (key.startsWith("uchet-") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

function scopePath() {
  return new URL(self.registration.scope).pathname;
}

/** Экран учёта: наш адрес, внутри области, не файл (не /uchet.webmanifest). */
function isPage(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(scopePath()) && !/\.[a-z0-9]+$/i.test(url.pathname);
}

/** Ключ копии экрана: без служебного _rsc и якоря. */
function pageKey(href) {
  const u = new URL(href);
  u.hash = "";
  u.searchParams.delete("_rsc");
  return u.toString();
}

function samePath(href) {
  const u = new URL(href);
  return u.origin + u.pathname;
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/** Годится ли ответ сервера в копию: 200, наш, без переадресации (например, на вход). */
function storable(res) {
  return res && res.ok && res.type === "basic" && !res.redirected && isPage(new URL(res.url));
}

async function findPage(cache, href) {
  return (
    (await cache.match(pageKey(href))) ||
    (await cache.match(samePath(href))) ||
    // Раздела нет в копиях — лучше касса, чем белый экран.
    (await cache.match(new URL("kassa", self.registration.scope.replace(/\/?$/, "/")).href)) ||
    null
  );
}

function offlinePage(cachedKeys) {
  const links = cachedKeys
    .map((k) => new URL(k))
    .filter((u) => !u.search)
    .map((u) => `<li><a href="${u.pathname}">${u.pathname.replace(/^\/uchet\/?/, "") || "главная"}</a></li>`)
    .join("");
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Нет связи · Флория Учёт</title>
<body style="font:16px/1.5 system-ui,sans-serif;background:#f4f4f5;color:#18181b;margin:0;padding:40px 24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:20px;padding:28px">
<h1 style="font-size:22px;margin:0 0 8px">Нет связи</h1>
<p style="margin:0 0 16px;color:#52525b">Этот экран ещё ни разу не открывался на этом айпаде, его копии нет. Продавать можно в кассе — продажи сохранятся и уйдут сами, когда связь вернётся.</p>
${links ? `<p style="margin:0 0 6px;font-weight:600">Сохранённые разделы:</p><ul style="margin:0;padding-left:20px">${links}</ul>` : ""}
<p style="margin:20px 0 0"><a href="" style="color:#5E4A96">Попробовать снова</a></p>
</div></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function handleNavigation(event) {
  const req = event.request;
  const cache = await caches.open(PAGES);
  const network = fetch(req).then(async (res) => {
    if (storable(res)) await cache.put(pageKey(req.url), res.clone());
    return res;
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), NAV_TIMEOUT_MS);
  });

  try {
    const res = await Promise.race([network, timeout]);
    clearTimeout(timer);
    // Сервер упал (502/503 от прокси) — копия полезнее страницы ошибки.
    if (res.status >= 500) {
      const cached = await findPage(cache, req.url);
      if (cached) return cached;
    }
    return res;
  } catch (e) {
    clearTimeout(timer);
    const cached = await findPage(cache, req.url);
    if (cached) {
      // Сеть медленная, но есть — пусть копия обновится в фоне.
      event.waitUntil(network.catch(() => undefined));
      return cached;
    }
    try {
      return await network;
    } catch (err) {
      return offlinePage((await cache.keys()).map((r) => r.url));
    }
  }
}

async function handleStatic(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    await cache.put(req, res.clone());
    trim(STATIC, STATIC_MAX);
  }
  return res;
}

async function handleImage(event) {
  const req = event.request;
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req.url);
  const refresh = (async () => {
    // Запрашиваем с CORS (хранилище его разрешает): «непрозрачные» ответы
    // браузер учитывает в квоте как многомегабайтные.
    let res;
    try {
      res = await fetch(req.url, { mode: "cors", credentials: "omit" });
    } catch {
      res = await fetch(req);
    }
    if (res.ok) {
      await cache.put(req.url, res.clone());
      trim(IMAGES, IMAGES_MAX);
    }
    return res;
  })();
  if (hit) {
    event.waitUntil(refresh.catch(() => undefined));
    return hit;
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate" && isPage(url)) {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStatic(req));
    return;
  }
  if (req.destination === "image" && (url.pathname.startsWith("/storage/v1/object/public/") || url.pathname === "/_next/image")) {
    event.respondWith(handleImage(event));
  }
  // Остальное (данные экранов при переходах, действия, API) — мимо.
});

// ---------------------------------------------------------------
// Прогрев и очистка — по просьбе страницы
// ---------------------------------------------------------------

const ASSET_RE = /(?:\/_next\/)?static\/(?:chunks|css|media)\/[^"'\s\\<>]+?\.(?:js|css|woff2?|ttf|otf)/g;

async function warm(urls) {
  const pages = await caches.open(PAGES);
  const statics = await caches.open(STATIC);
  const assets = new Set();
  for (const href of urls) {
    const url = new URL(href, self.location.origin);
    if (!isPage(url)) continue;
    try {
      const res = await fetch(url.href, { credentials: "same-origin", headers: { Accept: "text/html" } });
      if (!storable(res)) continue;
      await pages.put(pageKey(url.href), res.clone());
      const html = await res.text();
      for (const m of html.match(ASSET_RE) || []) assets.add(new URL("/_next/" + m.replace(/^\/_next\//, ""), self.location.origin).href);
    } catch {
      return; // связь пропала — в следующий раз
    }
  }
  for (const href of assets) {
    if (await statics.match(href)) continue;
    try {
      const res = await fetch(href);
      if (res.ok) await statics.put(href, res);
    } catch {
      return;
    }
  }
  trim(STATIC, STATIC_MAX);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "warm" && Array.isArray(data.urls)) {
    event.waitUntil(warm(data.urls.slice(0, 30)));
  }
  if (data.type === "forget-pages") {
    event.waitUntil(caches.delete(PAGES));
  }
});
