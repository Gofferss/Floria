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
// Переменные окружения:
//   POSIFLORA_API_URL, POSIFLORA_USERNAME, POSIFLORA_PASSWORD
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Запуск:
//   node scripts/uchet-import-posiflora.mjs [--snapshot] [--dry-run]
// ================================================================

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const SNAPSHOT = args.has("--snapshot");

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
  for (let page = 1; page <= 40; page++) {
    const j = await posi(`/inventory-items?page[size]=50&page[number]=${page}&include=group,measure`);
    for (const x of j.included ?? []) {
      if (x.type === "inventory-groups") groupTitle[x.id] = x.attributes?.title;
    }
    for (const it of j.data ?? []) {
      items.push({
        id: it.id,
        title: String(it.attributes?.title ?? "").replace(/\s+/g, " ").trim(),
        fractional: !!it.attributes?.fractional,
        deleted: !!it.attributes?.deleted,
        priceMax: Number(it.attributes?.priceMax) || 0,
        groupId: it.relationships?.group?.data?.id ?? null,
      });
    }
    if ((j.data ?? []).length < 50) break;
  }
  for (const it of items) it.group = it.groupId ? groupTitle[it.groupId] ?? null : null;
  return items;
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
  console.log(`  позиций: ${items.length}; категорий добрано поштучно: ${single}, не прочиталось: ${broken}`);

  // Группа = категория, иначе группа Posiflora, иначе «Без группы».
  for (const it of items) {
    it.groupTitle = pretty(categories[it.id] ?? it.group ?? "Без группы");
    it.kind = kindOf(it.groupTitle);
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

  // --- позиции ---
  const before = (await selectAll("inv_items", "posiflora_id")).length;
  for (let k = 0; k < items.length; k += 100) {
    const chunk = items.slice(k, k + 100).map((it) => ({
      title: it.title || "Без названия",
      group_id: groupId[it.groupTitle.toLowerCase()] ?? null,
      unit_code: "pcs",
      fractional: it.fractional,
      is_tracked: it.kind !== "service",
      sale_price: it.priceMax > 0 ? it.priceMax : null,
      is_active: !it.deleted,
      posiflora_id: it.id,
    }));
    await supa("inv_items?on_conflict=posiflora_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
  }
  const ours = await selectAll("inv_items", "id,posiflora_id");
  const ourId = Object.fromEntries(ours.filter((x) => x.posiflora_id).map((x) => [x.posiflora_id, x.id]));
  console.log(`  в базе позиций: ${ours.length} (добавлено сейчас: ${ours.length - before})`);

  if (!SNAPSHOT) return;

  // --- снимок ---
  const stores = await posi("/stores");
  const training = (stores.data ?? []).find((s) => s.id !== SHOP_STORE_ID)?.id ?? null;

  console.log(`\nСнимаю остатки (${items.length} позиций, точка «Флория»${training ? " и тренировочный склад" : ""})…`);
  const snap = [];
  const failed = [];
  await pool(items, 6, async (it) => {
    try {
      const shop = summarize(await movements(it.id, SHOP_STORE_ID));
      const train = training ? summarize(await movements(it.id, training)) : { qty: 0 };
      snap.push({
        item_id: ourId[it.id],
        qty: shop.qty,
        unit_cost: shop.unitCost,
        last_movement_at: shop.last,
        movements: shop.count,
        training_qty: train.qty,
        taken_at: new Date().toISOString(),
        _title: it.title,
        _kind: it.kind,
      });
    } catch (e) {
      failed.push(`${it.title}: ${e.message}`);
    }
  });

  const rows = snap.filter((s) => s.item_id).map(({ _title, _kind, ...row }) => row);
  for (let k = 0; k < rows.length; k += 200) {
    await supa("inv_posiflora_snapshot?on_conflict=item_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(k, k + 200)),
    });
  }

  // --- отчёт ---
  const days = (d) => (d ? (Date.now() - new Date(d).getTime()) / 86400000 : Infinity);
  const positive = snap.filter((s) => s.qty > 0);
  const negative = snap.filter((s) => s.qty < 0);
  const alive90 = snap.filter((s) => days(s.last_movement_at) <= 90);
  const never = snap.filter((s) => s.movements === 0);
  const trainingLeft = snap.filter((s) => s.training_qty !== 0);
  const value = positive.reduce((sum, s) => sum + s.qty * (s.unit_cost ?? 0), 0);
  const noCost = positive.filter((s) => s.unit_cost === null);

  console.log("\n=== Снимок ===");
  console.log(`  записано: ${rows.length}, не прочиталось: ${failed.length}`);
  console.log(`  с остатком > 0:            ${positive.length}`);
  console.log(`  в минусе:                  ${negative.length}`);
  console.log(`  двигались за 90 дней:      ${alive90.length}`);
  console.log(`  не двигались никогда:      ${never.length}`);
  console.log(`  остаток на тренировочном:  ${trainingLeft.length} позиций`);
  console.log(`  стоимость остатка (оценка): ${Math.round(value).toLocaleString("ru-RU")} ₽`);
  console.log(`  с остатком, но без цены:   ${noCost.length}`);
  if (negative.length) {
    console.log("\n  в минусе (до 10):");
    negative.slice(0, 10).forEach((s) => console.log(`    ${String(s.qty).padStart(7)}  ${s._title.slice(0, 50)}`));
  }
  if (failed.length) {
    console.log("\n  не прочиталось (до 5):");
    failed.slice(0, 5).forEach((f) => console.log("    " + f.slice(0, 100)));
  }
}

main().catch((e) => {
  console.error("Сбой импорта:", e.message);
  process.exit(1);
});
