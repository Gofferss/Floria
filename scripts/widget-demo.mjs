// Показ живой карточки заказа владельцу: пример с вымышленными данными,
// который сам проходит этапы заказа. Шлёт ТОЛЬКО в чат владельца (по телефону
// учётной записи с ролью owner), больше никому.
// Запуск — разовой задачей в контейнере сайта (там ключи):
//   S=<коммит> node -e "fetch('https://raw.githubusercontent.com/Gofferss/Floria/'+process.env.S+'/scripts/widget-demo.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))"
const env = process.env;
const sha = env.S;
const TG = (env.TELEGRAM_API_BASE || "https://qgogldtdzhyqiarvpgwk.supabase.co/functions/v1/telegram-relay") + "/bot" + env.TELEGRAM_BOT_TOKEN;
const DB = env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1";
const dbh = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(method, body) {
  const r = await fetch(`${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}

function e164(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) return "+7" + d.slice(1);
  if (d.length === 10) return "+7" + d;
  return null;
}

const src = await (await fetch(`https://raw.githubusercontent.com/Gofferss/Floria/${sha}/lib/telegram/order-widget-html.ts`)).text();
const html = src.slice(src.indexOf("`") + 1, src.lastIndexOf("`"));

// Чат владельца: явно (C=<chat_id> — тот, куда Coolify шлёт владельцу тревоги)
// или по телефону учётной записи с ролью owner.
async function ownerChat() {
  if (env.C && /^\d+$/.test(env.C)) return Number(env.C);
  const owners = await (await fetch(`${DB}/staff?select=phone&role=eq.owner&is_active=eq.true`, { headers: dbh })).json();
  const phones = owners.map((o) => e164(o.phone)).filter(Boolean);
  if (!phones.length) throw new Error("у владельца в учёте нет телефона — передайте C=<chat_id>");
  const bots = await (await fetch(`${DB}/bot_users?select=chat_id&is_blocked=eq.false&phone=in.(${phones.map(encodeURIComponent).join(",")})`, { headers: dbh })).json();
  if (!bots.length) throw new Error("владелец не подключён к боту");
  return bots[0].chat_id;
}
const chatId = await ownerChat();

const base = {
  n: "FL-ПРИМЕР",
  p: 0,
  w: "14 ноября, 10:00–13:00",
  a: "ул. Примерная, 1, кв. 5",
  i: ["Букет из розовой хризантемы × 1", "Открытка × 1"],
  t: "2 500 ₽",
  pd: 0,
};
const msg = await tg("sendWidget", {
  chat_id: chatId,
  html,
  chat_data: JSON.stringify({ ...base, s: "new" }),
  caption: "Пример живой карточки заказа — данные вымышленные. Сейчас она сама пройдёт все этапы, по одному каждые 4 секунды.",
  protect_content: true,
});
console.log("карточка отправлена владельцу, сообщение", msg.message_id, "| html", Buffer.byteLength(html), "байт");

for (const [s, pd] of [["confirmed", 1], ["assembling", 1], ["ready", 1], ["delivering", 1], ["completed", 1]]) {
  await sleep(4000);
  await tg("editMessageWidgetData", { chat_id: chatId, message_id: msg.message_id, chat_data: JSON.stringify({ ...base, s, pd }) });
  console.log("этап:", s);
}
console.log("готово");
