// Порция продаж Posiflora для анализа сезонности. Только чтение, в один проход:
// ничего не оставляет на сервере, печатает результат и завершается.
// Клиентов, телефонов, адресов и текстов заказов не берёт.
//   P=<первая страница> N=<страниц> — заказы со строками
import zlib from "node:zlib";
const POSI = process.env.POSIFLORA_API_URL.replace(/\/+$/, "");
const P = Number(process.env.P || 1), N = Number(process.env.N || 30), SIZE = 50;
let token;
async function login() {
  const s = await (await fetch(`${POSI}/sessions`, { method: "POST", headers: { "Content-Type": "application/vnd.api+json" }, body: JSON.stringify({ data: { type: "sessions", attributes: { username: process.env.POSIFLORA_USERNAME, password: process.env.POSIFLORA_PASSWORD } } }) })).json();
  token = s?.data?.attributes?.accessToken;
  if (!token) throw new Error("вход не удался");
}
async function get(p) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`${POSI}${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" }, signal: AbortSignal.timeout(30000) });
      if (r.status === 401) { await login(); continue; }
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500 * (a + 1))); continue; }
      if (!r.ok) throw Object.assign(new Error(`${r.status}`), { fatal: true });
      return await r.json();
    } catch (e) { if (e.fatal || a === 3) throw e; await new Promise((s) => setTimeout(s, 1500 * (a + 1))); }
  }
  throw new Error("нет ответа");
}
await login();
const started = Date.now();
const orders = [], lines = [], bq = {}, titles = {};
let total = null, last = P - 1;
const pages = Array.from({ length: N }, (_, i) => P + i);
let i = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (i < pages.length && Date.now() - started < 45000) {
    const page = pages[i++];
    const j = await get(`/orders?page[size]=${SIZE}&page[number]=${page}&include=lines,lines.item,lines.bouquet`);
    total = j.meta?.total ?? total;
    last = Math.max(last, page);
    const inc = new Map((j.included || []).map((x) => [`${x.type}:${x.id}`, x]));
    for (const o of j.data) {
      const a = o.attributes, id = o.id.slice(0, 8);
      orders.push([id, a.date, a.status, Number(a.totalAmount) || 0, a.delivery ? 1 : 0, a.posted ? 1 : 0]);
      for (const l of o.relationships?.lines?.data || []) {
        const x = inc.get(`order-lines:${l.id}`); if (!x) continue;
        const la = x.attributes, it = x.relationships?.item?.data?.id, b = x.relationships?.bouquet?.data?.id;
        const itS = it ? it.slice(0, 8) : null, bS = b ? b.slice(0, 8) : null;
        if (it && !titles[itS]) titles[itS] = inc.get(`inventory-items:${it}`)?.attributes?.title ?? "?";
        if (b && !bq[bS]) { const ba = inc.get(`bouquets:${b}`)?.attributes; bq[bS] = [ba?.amount ?? null, ba?.saleAmount ?? null, ba?.trueSaleAmount ?? null, ba?.title ?? null]; }
        lines.push([id, itS, Number(la.qty) || 0, Number(la.price) || 0, Number(la.totalAmountWithDiscount) || 0, bS]);
      }
    }
  }
}));
const gz = zlib.gzipSync(JSON.stringify({ orders, lines, bq, titles }), { level: 9 }).toString("base64");
console.log(`META total=${total} from=${P} done=${last} orders=${orders.length} lines=${lines.length} sec=${Math.round((Date.now() - started) / 1000)} len=${gz.length}`);
console.log(`DATA ${gz}`);
console.log("END");
