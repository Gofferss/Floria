// ================================================================
// Импорт номенклатуры и снимка остатков из Posiflora в «Флория Учёт».
//
// Posiflora только ЧИТАЕТСЯ. Ничего в ней не создаётся, не меняется, не
// удаляется и не архивируется — это требование владельца.
//
// Что делает:
//   1. Позиции склада (646) с группами. Группой у нас становится КАТЕГОРИЯ
//      Posiflora, а не её «группа»: там 169 роз лежат в группе «Прочие»,
//      а категория при этом осмысленная — «РОЗА». Нет категории — берём
//      группу.
//   2. С ключом --snapshot — остаток каждой позиции в точке «Флория»
//      (сумма движений), себестоимость единицы по суммам движений, дату
//      последнего движения и остаток на тренировочном «СКЛАДе» отдельно.
//
// Повторный запуск безопасен: существующие группы и позиции НЕ
// перезаписываются (правки владельца важнее), добавляются только новые.
// Снимок остатков обновляется всегда — на то он и снимок.
//
// С ключом --refresh дополнительно уточняет у ещё НЕ тронутых владельцем
// позиций (updated_at не позже чем через 2 минуты после created_at):
//   * действует ли позиция — по activePoints каталога Posiflora. В «Обзоре
//     склада» владелец видит 203 позиции, остальные там выключены;
//   * цену продажи — из отчёта точки (stats-by-store), если её нет;
//   * фото — копирует в наше хранилище. Ссылаться на CDN Posiflora нельзя:
//     после отключения подписки картинки пропадут.
//
// Остаток и себестоимость в снимке — из того же отчёта точки, то есть ровно
// те цифры, что владелец видит в «Обзоре склада». Остаток по нему и по сумме
// движений сверен на 40 позициях — совпал во всех. Себестоимость своя у
// Posiflora точнее моей оценки по суммам движений, поэтому берём её.
//
// Переменные окружения:
//   POSIFLORA_API_URL, POSIFLORA_USERNAME, POSIFLORA_PASSWORD
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Запуск:
//   node scripts/uchet-import-posiflora.mjs [--snapshot] [--refresh] [--dry-run]
// ================================================================

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const SNAPSHOT = args.has("--snapshot");
const REFRESH = args.has("--refresh");

/** Бакет, куда копируются фото позиций склада. Тот же, что у каталога сайта. */
const PHOTO_BUCKET = "product-images";

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Не задана переменная окружения ${name}`);
    process.exit(1);
  }
  return value.trim();
}

const POSI = need("POSIFLORA_API_URL").replace(/\/+$/, "");
const SUPA = need("SUPABASE_URL").replace(/\/+$/, "");
const KEY = need("SUPABASE_SERVICE_ROLE_KEY");

/** Точка «Флория» — настоящий магазин. */
const SHOP_STORE_ID = "5be91e82-40fd-4a86-9ea0-67aa17be54f0";

// ---------------------------------------------------------------
// Posiflora — только GET (кроме входа)
// ---------------------------------------------------------------

let token = null;

async function login() {
  const r = await fetch(`${POSI}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/vnd.api+json" },
    body: JSON.stringify({
      data: {
        type: "sessions",
        attributes: { username: need("POSIFLORA_USERNAME"), password: need("POSIFLORA_PASSWORD") },
      },
    }),
  });
  const j = await r.json();
  token = j?.data?.attributes?.accessToken;
  if (!token) throw new Error("Posiflora: не удалось войти");
}

/** GET с одним повтором после перевхода — сессия за долгий снимок может истечь. */
async function posi(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${POSI}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" },
    });
    if (r.status === 401 && attempt === 0) {
      await login();
      continue;
    }
    if (!r.ok) {
      const e = new Error(`Posiflora ${r.status} на ${path.slice(0, 80)}`);
      e.status = r.status;
      throw e;
    }
    return r.json();
  }
  throw new Error("Posiflora: повторный отказ после перевхода");
}

// ---------------------------------------------------------------
// Supabase (service role)
// ---------------------------------------------------------------

async function supa(path, init = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`База ${r.status} на ${path.slice(0, 60)}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function selectAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await supa(`${table}?select=${columns}`, {
      headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" },
    });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------
// Группы
// ---------------------------------------------------------------

/** «РОЗА» → «Роза». Смешанный регистр («Букет до») оставляем как есть. */
function pretty(title) {
  const t = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return t;
  const letters = t.replace(/[^A-Za-zА-Яа-яЁё]/g, "");
  if (letters && letters === letters.toUpperCase()) {
    const lower = t.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return t;
}

/**
 * Вид группы по её названию. Нужен логике: свежесть считается для цветов,
 * услуги не ведутся по остаткам. Всё неизвестное — «прочее», владелец
 * поправит в админке.
 */
const KIND_BY_GROUP = new Map([
  ["цветы", "flower"],
  ["роза", "flower"],
  ["кустовая роза", "flower"],
  ["хризантемы", "flower"],
  ["гиацинт", "flower"],
  ["горшки", "flower"],
  ["уценка", "flower"],
  ["сухоцветы", "decor"],
  ["искусственные цветы", "decor"],
  ["игрушки", "gift"],
  ["шары", "gift"],
  ["открытки", "print"],
  ["полиграфия", "print"],
  ["упаковка", "packaging"],
  ["услуги", "service"],
  ["букет до", "bouquet"],
]);

function kindOf(groupTitle) {
  return KIND_BY_GROUP.get(groupTitle.toLowerCase()) ?? "other";
}

// ---------------------------------------------------------------
// Чтение номенклатуры
// ---------------------------------------------------------------

async function fetchItems() {
  const items = [];
  const groupTitle = {};
  const logoFile = {};
  for (let page = 1; page <= 40; page++) {
    const j = await posi(`/inventory-items?page[size]=50&page[number]=${page}&include=group,measure,logo`);
    for (const x of j.included ?? []) {
      if (x.type === "inventory-groups") groupTitle[x.id] = x.attributes?.title;
      if (x.type === "images" && x.attributes?.file) logoFile[x.id] = x.attributes.file;
    }
    for (const it of j.data ?? []) {
      const logoId = it.relationships?.logo?.data?.id ?? null;
      items.push({
        id: it.id,
        title: String(it.attributes?.title ?? "").replace(/\s+/g, " ").trim(),
        fractional: !!it.attributes?.fractional,
        deleted: !!it.attributes?.deleted,
        priceMax: Number(it.attributes?.priceMax) || 0,
        groupId: it.relationships?.group?.data?.id ?? null,
        logoId,
      });
    }
    if ((j.data ?? []).length < 50) break;
  }
  for (const it of items) {
    it.group = it.groupId ? groupTitle[it.groupId] ?? null : null;
    it.logo = it.logoId ? logoFile[it.logoId] ?? null : null;
  }
  return items;
}

/** Активность позиции: в скольких точках она включена (то, что в «Обзоре склада» — «1 из 1»). */
async function fetchActivePoints() {
  const active = {};
  for (let page = 1; page <= 40; page++) {
    const j = await posi(`/catalog?page[size]=50&page[number]=${page}`);
    for (const c of j.data ?? []) {
      if (c.attributes?.itemId) active[c.attributes.itemId] = Number(c.attributes.activePoints) || 0;
    }
    if ((j.data ?? []).length < 50) break;
  }
  return active;
}

/** Отчёт точки по позиции: остаток, себестоимость, цена — как в «Обзоре склада». */
async function storeStats(itemId) {
  const j = await posi(`/inventory-items/${itemId}/stats-by-store/${SHOP_STORE_ID}`);
  const a = j.data?.attributes ?? {};
  const num = (x) => (x === null || x === undefined || x === "" ? null : Number(x));
  return { qty: num(a.qty) ?? 0, cost: num(a.cost), price: num(a.price) };
}

/** Скопировать фото с CDN Posiflora в наше хранилище. Возвращает наш адрес или null. */
async function copyPhoto(posifloraId, url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg";
    const path = `inventory/${posifloraId}.${ext}`;
    const body = Buffer.from(await r.arrayBuffer());
    const up = await fetch(`${SUPA}/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": type, "x-upsert": "true" },
      body,
    });
    return up.ok ? `${SUPA}/storage/v1/object/public/${PHOTO_BUCKET}/${path}` : null;
  } catch {
    return null;
  }
}

/**
 * Категории. Постранично с include=category часть страниц отвечает 500 —
 * похоже, на отдельных позициях со сломанной категорией. Такие позиции
 * добираем поштучно; не вышло и поштучно — остаёмся на группе.
 */
async function fetchCategories(items) {
  const byId = {};
  const catTitle = {};
  for (let page = 1; page <= 60; page++) {
    let j;
    try {
      j = await posi(`/inventory-items?page[size]=20&page[number]=${page}&include=category`);
    } catch {
      continue;
    }
    for (const x of j.included ?? []) {
      if (x.type === "categories") catTitle[x.id] = x.attributes?.title;
    }
    for (const it of j.data ?? []) {
      const c = it.relationships?.category?.data?.id;
      byId[it.id] = c ? catTitle[c] ?? null : null;
    }
    if ((j.data ?? []).length < 20) break;
  }

  let single = 0;
  let broken = 0;
  for (const it of items) {
    if (it.id in byId) continue;
    single++;
    try {
      const j = await posi(`/inventory-items/${it.id}?include=category`);
      const c = j.data?.relationships?.category?.data?.id;
      const inc = (j.included ?? []).find((x) => x.type === "categories" && x.id === c);
      byId[it.id] = inc?.attributes?.title ?? null;
    } catch {
      byId[it.id] = null;
      broken++;
    }
  }
  return { byId, single, broken };
}

// ---------------------------------------------------------------
// Снимок остатков
// ---------------------------------------------------------------

async function movements(itemId, storeId) {
  const rows = [];
  const end = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  for (let page = 1; page <= 30; page++) {
    const p = new URLSearchParams({
      "filter[startDate]": "2000-01-01",
      "filter[endDate]": end,
      "page[number]": String(page),
      "page[size]": "200",
    });
    const j = await posi(`/inventory-items/${itemId}/warehouse-movement/${storeId}?${p}`);
    const chunk = j.data ?? [];
    rows.push(...chunk.map((m) => m.attributes ?? {}));
    if (chunk.length < 200) break;
  }
  return rows;
}

function summarize(rows) {
  let qty = 0;
  let inQty = 0;
  let inAmount = 0;
  let last = null;
  for (const m of rows) {
    const q = Number(m.qty) || 0;
    qty += q;
    if (q > 0) {
      inQty += q;
      inAmount += Math.abs(Number(m.amount) || 0);
    }
    if (m.date && (!last || m.date > last)) last = m.date;
  }
  return {
    qty: Math.round(qty * 1000) / 1000,
    unitCost: inQty > 0 && inAmount > 0 ? Math.round((inAmount / inQty) * 10000) / 10000 : null,
    last,
    count: rows.length,
  };
}

async function pool(list, size, fn) {
  let i = 0;
  let done = 0;
  const workers = Array.from({ length: size }, async () => {
    while (i < list.length) {
      const k = i++;
      await fn(list[k], k);
      done++;
      if (done % 100 === 0) console.log(`  снимок: ${done} из ${list.length}`);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------

async function main() {
  await login();

  console.log("Читаю номенклатуру Posiflora…");
  const items = await fetchItems();
  const { byId: categories, single, broken } = await fetchCategories(items);
  const activePoints = await fetchActivePoints();
  console.log(`  позиций: ${items.length}; категорий добрано поштучно: ${single}, не прочиталось: ${broken}`);
  console.log(`  включены в точке: ${items.filter((it) => (activePoints[it.id] ?? 0) > 0).length}`);
  console.log(`  с фото: ${items.filter((it) => it.logo).length}`);

  // Группа = категория, иначе группа Posiflora, иначе «Без группы».
  for (const it of items) {
    it.groupTitle = pretty(categories[it.id] ?? it.group ?? "Без группы");
    it.kind = kindOf(it.groupTitle);
    it.active = !it.deleted && (activePoints[it.id] ?? 0) > 0;
  }

  const groupTitles = [...new Set(items.map((it) => it.groupTitle))].sort();
  console.log(`  групп: ${groupTitles.length}`);

  if (DRY) {
    const byGroup = {};
    for (const it of items) byGroup[it.groupTitle] = (byGroup[it.groupTitle] ?? 0) + 1;
    Object.entries(byGroup).sort((a, b) => b[1] - a[1]).forEach(([g, n]) =>
      console.log(`    ${String(n).padStart(4)}  ${g}  (${kindOf(g)})`));
    console.log("\n--dry-run: в базу ничего не записано");
    return;
  }

  // --- группы ---
  await supa("inv_groups?on_conflict=posiflora_key", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(groupTitles.map((t, i) => ({
      title: t,
      kind: kindOf(t),
      sort: i * 10,
      posiflora_key: t.toLowerCase(),
    }))),
  });
  const groups = await selectAll("inv_groups", "id,posiflora_key");
  const groupId = Object.fromEntries(groups.filter((g) => g.posiflora_key).map((g) => [g.posiflora_key, g.id]));

  // --- новые позиции ---
  const before = await selectAll("inv_items", "posiflora_id");
  const known = new Set(before.map((x) => x.posiflora_id));
  const fresh = items.filter((it) => !known.has(it.id));
  for (let k = 0; k < fresh.length; k += 100) {
    const chunk = fresh.slice(k, k + 100).map((it) => ({
      title: it.title || "Без названия",
      group_id: groupId[it.groupTitle.toLowerCase()] ?? null,
      unit_code: "pcs",
      fractional: it.fractional,
      is_tracked: it.kind !== "service",
      sale_price: it.priceMax > 0 ? it.priceMax : null,
      is_active: it.active,
      posiflora_id: it.id,
    }));
    await supa("inv_items?on_conflict=posiflora_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
  }
  const ours = await selectAll("inv_items", "id,posiflora_id,created_at,updated_at,sale_price,photo_url,is_active");
  const ourBy = Object.fromEntries(ours.filter((x) => x.posiflora_id).map((x) => [x.posiflora_id, x]));
  console.log(`  в базе позиций: ${ours.length} (добавлено сейчас: ${fresh.length})`);

  // --- снимок остатков (и цены для уточнения) ---
  let stats = {};
  if (SNAPSHOT || REFRESH) {
    console.log(`\nЧитаю отчёт точки по ${items.length} позициям…`);
    const failed = [];
    await pool(items, 6, async (it) => {
      try {
        stats[it.id] = await storeStats(it.id);
      } catch (e) {
        failed.push(`${it.title}: ${e.message}`);
      }
    });
    if (failed.length) console.log(`  не прочиталось: ${failed.length} — например ${failed[0]}`);
  }

  if (SNAPSHOT) {
    // Дату последнего движения и остаток на тренировочном складе даёт только
    // журнал движений — читаем его заодно.
    const stores = await posi("/stores");
    const training = (stores.data ?? []).find((s) => s.id !== SHOP_STORE_ID)?.id ?? null;
    console.log("Читаю даты последних движений…");
    const moves = {};
    await pool(items, 6, async (it) => {
      try {
        const shop = summarize(await movements(it.id, SHOP_STORE_ID));
        const train = training ? summarize(await movements(it.id, training)) : { qty: 0 };
        moves[it.id] = { last: shop.last, count: shop.count, training: train.qty };
      } catch {
        // без даты движения позиция всё равно попадёт в снимок
      }
    });

    const rows = items
      .filter((it) => ourBy[it.id] && stats[it.id])
      .map((it) => ({
        item_id: ourBy[it.id].id,
        qty: stats[it.id].qty,
        unit_cost: stats[it.id].cost !== null && stats[it.id].cost >= 0 ? stats[it.id].cost : null,
        last_movement_at: moves[it.id]?.last ?? null,
        movements: moves[it.id]?.count ?? 0,
        training_qty: moves[it.id]?.training ?? 0,
        taken_at: new Date().toISOString(),
      }));
    for (let k = 0; k < rows.length; k += 200) {
      await supa("inv_posiflora_snapshot?on_conflict=item_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows.slice(k, k + 200)),
      });
    }

    const positive = rows.filter((r) => r.qty > 0);
    const negative = rows.filter((r) => r.qty < 0);
    const value = positive.reduce((s, r) => s + r.qty * (r.unit_cost ?? 0), 0);
    console.log("\n=== Снимок ===");
    console.log(`  записано: ${rows.length}`);
    console.log(`  с остатком > 0: ${positive.length}, в минусе: ${negative.length}`);
    console.log(`  стоимость остатка по себестоимости Posiflora: ${Math.round(value).toLocaleString("ru-RU")} ₽`);
  }

  // --- уточнение нетронутых позиций ---
  if (REFRESH) {
    const untouched = (x) => new Date(x.updated_at).getTime() - new Date(x.created_at).getTime() < 2 * 60 * 1000;
    let activity = 0;
    let prices = 0;
    let photos = 0;
    let skipped = 0;

    console.log("\nУточняю нетронутые позиции и копирую фото…");
    await pool(items, 4, async (it) => {
      const row = ourBy[it.id];
      if (!row) return;
      if (!untouched(row)) {
        skipped++;
        return;
      }
      const patch = {};
      if (row.is_active !== it.active) {
        patch.is_active = it.active;
        activity++;
      }
      const price = stats[it.id]?.price ?? null;
      if (row.sale_price === null && price && price > 0) {
        patch.sale_price = price;
        prices++;
      }
      if (!row.photo_url && it.logo) {
        const url = await copyPhoto(it.id, it.logo);
        if (url) {
          patch.photo_url = url;
          photos++;
        }
      }
      if (Object.keys(patch).length === 0) return;
      // Триггер set_updated_at отметит позицию изменённой, и следующий запуск
      // с --refresh её пропустит. Так и задумано: уточнение применяется один
      // раз, к позициям, которых ещё никто не трогал.
      await supa(`inv_items?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
    });

    console.log("\n=== Уточнение ===");
    console.log(`  активность поправлена: ${activity}`);
    console.log(`  цены добавлены:        ${prices}`);
    console.log(`  фото скопированы:      ${photos}`);
    console.log(`  пропущено (владелец уже правил): ${skipped}`);
  }
}

main().catch((e) => {
  console.error("Сбой импорта:", e.message);
  process.exit(1);
});
