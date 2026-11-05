// Порция складских движений Posiflora по месяцам: закупка, продажа, списания.
// Только чтение, в один проход, ничего не оставляет на сервере.
//   P=<с какой позиции, с 1> N=<сколько позиций>
import zlib from "node:zlib";
const POSI = process.env.POSIFLORA_API_URL.replace(/\/+$/, "");
const STORE = "5be91e82-40fd-4a86-9ea0-67aa17be54f0";
const P = Number(process.env.P || 1), N = Number(process.env.N || 150);
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
const all = [];
for (let p = 1; p < 60; p++) {
  const j = await get(`/inventory-items?page[size]=50&page[number]=${p}&include=group,measure`);
  const inc = new Map((j.included || []).map((x) => [`${x.type}:${x.id}`, x]));
  for (const it of j.data) all.push({ id: it.id, t: it.attributes.title, g: inc.get(`inventory-groups:${it.relationships?.group?.data?.id}`)?.attributes?.title ?? null, m: inc.get(`measures:${it.relationships?.measure?.data?.id}`)?.attributes?.title ?? null, d: it.attributes.deleted ? 1 : 0 });
  if (j.data.length < 50) break;
}
all.sort((a, b) => (a.id < b.id ? -1 : 1));
const slice = all.slice(P - 1, P - 1 + N);
const out = {};
let i = 0, done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (i < slice.length && Date.now() - started < 45000) {
    const it = slice[i++], acc = {};
    for (let p = 1; p < 40; p++) {
      const q = new URLSearchParams({ "filter[startDate]": "2000-01-01", "filter[endDate]": new Date().toISOString().slice(0, 10), "page[number]": String(p), "page[size]": "200" });
      const j = await get(`/inventory-items/${it.id}/warehouse-movement/${STORE}?${q}`);
      for (const r of j.data || []) { const a = r.attributes, key = `${(a.date || "").slice(0, 7)}|${a.transType}|${Number(a.qty) > 0 ? "+" : "-"}`; const c = (acc[key] ||= [0, 0, 0]); c[0] += Number(a.qty) || 0; c[1] += Number(a.amount) || 0; c[2]++; }
      if ((j.data || []).length < 200) break;
    }
    out[it.id.slice(0, 8)] = { t: it.t, g: it.g, m: it.m, d: it.d, mv: Object.entries(acc).map(([k, v]) => [k, Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100, v[2]]) };
    done++;
  }
}));
const gz = zlib.gzipSync(JSON.stringify(out), { level: 9 }).toString("base64");
console.log(`META total=${all.length} from=${P} want=${slice.length} done=${done} sec=${Math.round((Date.now() - started) / 1000)} len=${gz.length}`);
console.log(`DATA ${gz}`);
console.log("END");
