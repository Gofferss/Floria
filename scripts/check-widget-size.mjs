// Проверка: HTML виджетов укладывается в лимиты Telegram (32 КБ, 4 КБ после zlib -9).
//   node scripts/check-widget-size.mjs
import { deflateSync } from "node:zlib";
import { ORDER_WIDGET_HTML } from "../lib/telegram/order-widget-html.ts";
import { OWNER_PANEL_HTML } from "../lib/telegram/owner-panel-html.ts";

let bad = false;
for (const [name, html] of Object.entries({ ORDER_WIDGET_HTML, OWNER_PANEL_HTML })) {
  const raw = Buffer.byteLength(html, "utf8");
  const packed = deflateSync(Buffer.from(html, "utf8"), { level: 9 }).length;
  const ok = raw <= 32768 && packed <= 4096 && !html.includes("\0");
  if (!ok) bad = true;
  console.log(`${name}: ${raw} байт, сжато ${packed} из 4096 — ${ok ? "ок" : "НЕ ВЛЕЗАЕТ"}`);
}
process.exit(bad ? 1 : 0);
