// Почему Telegram не принимает виджет: пробуем крошечный виджет с запросами и без,
// в чат владельца, без звука, и сразу удаляем. Печатаем только ok / текст ошибки.
//   C=<chat_id> node -e "fetch('https://raw.githubusercontent.com/Gofferss/Floria/<коммит>/scripts/widget-probe.mjs')…"
const env = process.env;
const TG = (env.TELEGRAM_API_BASE || "https://qgogldtdzhyqiarvpgwk.supabase.co/functions/v1/telegram-relay") + "/bot" + env.TELEGRAM_BOT_TOKEN;
const chat = Number(env.C);
async function tg(method, body) {
  const r = await fetch(`${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
for (const [name, extra] of [
  ["без запросов", {}],
  ["с запросами (allow_queries)", { allow_queries: true }],
  ["с запросами и защитой", { allow_queries: true, protect_content: true }],
]) {
  const j = await tg("sendWidget", { chat_id: chat, html: "<p>проверка</p>", disable_notification: true, ...extra });
  console.log(name, "→", j.ok ? "принят" : j.description);
  if (j.ok) await tg("deleteMessage", { chat_id: chat, message_id: j.result.message_id });
}
