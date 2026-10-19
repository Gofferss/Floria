// ================================================================
// Проверка связи с платёжным шлюзом ВТБ.
//
// Отвечает на три вопроса, на которые иначе отвечает только первый
// живой клиент с деньгами:
//   1. Выдаёт ли банк токен нашими ключами (и доверяем ли мы его
//      сертификату — см. certs/README.md про НУЦ Минцифры).
//   2. Принимает ли он заказ на оплату в том виде, в каком мы его шлём.
//   3. Возвращает ли ссылку на СБП. Это открытый вопрос к банку: СБП
//      в заявке выбран, но в письме с тестовыми параметрами про него ни
//      слова, прислали только карту.
//
// Запускается руками, внутри контейнера приложения — там есть и ключи,
// и сертификаты НУЦ.
//
// ВАЖНО: скрипт СОЗДАЁТ заказ на оплату, поэтому работает только на
// песочнице. На боевых ключах он откажется запускаться: платёжный ордер
// в бою — это настоящий счёт, а не проверка.
// ================================================================

const base = (process.env.VTB_API_BASE ?? "").replace(/\/+$/, "");
const tokenUrl = process.env.VTB_TOKEN_URL ?? "";
const clientId = process.env.VTB_CLIENT_ID ?? "";
const clientSecret = process.env.VTB_CLIENT_SECRET ?? "";
const merchantAuth = process.env.VTB_MERCHANT_AUTH ?? "";

function out(label, value) {
  console.log("  " + String(label).padEnd(26) + value);
}

if (!base || !tokenUrl || !clientId || !clientSecret) {
  console.log("НЕ НАСТРОЕНО: часть переменных VTB_* пуста");
  process.exit(1);
}

// Единственная защита от случайного запуска по боевому шлюзу.
if (!/test/i.test(base)) {
  console.log("ОТКАЗ: VTB_API_BASE не похож на песочницу (" + base + ").");
  console.log("Скрипт создаёт настоящий заказ на оплату и в бою запускаться не должен.");
  process.exit(1);
}

const ibmClientId = clientId.split("@")[0].toLowerCase();
const orderId = "SMOKE-" + Date.now().toString(36).toUpperCase();

console.log("=== 1. Токен ===");
const tokenResponse = await fetch(tokenUrl, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  }),
}).catch((e) => {
  // Сетевую ошибку разворачиваем: за безликим "fetch failed" почти всегда
  // прячется недоверенный сертификат, и это надо увидеть сразу.
  console.log("  СБОЙ СЕТИ: " + e.message + "  причина: " + (e.cause?.code ?? "—"));
  process.exit(1);
});

const tokenText = await tokenResponse.text();
out("ответ", tokenResponse.status);
if (!tokenResponse.ok) {
  out("тело", tokenText.slice(0, 300));
  process.exit(1);
}

const tokenData = JSON.parse(tokenText);
// Сам токен не печатаем — он попадёт в журнал задачи, который хранится.
out("access_token", tokenData.access_token ? "получен" : "НЕТ В ОТВЕТЕ");
out("живёт секунд", tokenData.expires_in ?? "—");

const headers = {
  Authorization: `Bearer ${tokenData.access_token}`,
  "X-IBM-Client-Id": ibmClientId,
  "Content-Type": "application/json",
  ...(merchantAuth ? { "Merchant-Authorization": merchantAuth } : {}),
};

console.log("\n=== 2. Заказ на оплату ===");
const expire = new Date(Date.now() + 30 * 60_000).toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z");

const createResponse = await fetch(`${base}/v1/orders`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    orderId,
    orderName: "Проверка связи",
    expire,
    returnPaymentData: "sbp",
    amount: { value: 1, code: "RUB" },
    returnUrl: "https://floria-simferopol.ru/orders",
    customer: { customerId: orderId, phone: "79780000000", email: "test@floria-simferopol.ru" },
    bundle: {
      fiscalInfo: { clientEmail: "test@floria-simferopol.ru" },
      // price и amount здесь ЧИСЛА, в отличие от суммы заказа выше —
      // так требует шлюз. Ставка берётся из той же переменной, что и в
      // боевом коде, иначе проверка проверяла бы не то, что работает.
      items: [
        {
          positionId: 1,
          name: "Проверка связи",
          price: 1,
          quantity: 1,
          amount: 1,
          taxParams: { taxType: process.env.VTB_TAX_TYPE?.trim() || "none" },
        },
      ],
    },
  }),
});

const createText = await createResponse.text();
out("ответ", createResponse.status);
out("наш номер", orderId);

if (!createResponse.ok) {
  out("тело", createText.slice(0, 500));
  process.exit(1);
}

const created = JSON.parse(createText).object ?? {};
out("orderCode", created.orderCode ?? "—");
out("ссылка на карту", created.payUrl ? "есть" : "НЕТ");
out("истекает", created.expire ?? "—");

const prepared = created.preparedPayments ?? [];
out("способы оплаты", prepared.length ? prepared.map((p) => p.type).join(", ") : "только карта");

const sbp = prepared.find((p) => p.type === "sbp");
out("СБП", sbp?.object?.url ? "ДОСТУПЕН" : "НЕ ВЕРНУЛСЯ");

console.log("\n=== 3. Чтение статуса ===");
const readResponse = await fetch(`${base}/v1/orders/${encodeURIComponent(orderId)}`, { headers });
const readText = await readResponse.text();
out("ответ", readResponse.status);

if (readResponse.ok) {
  const state = JSON.parse(readText).object ?? {};
  out("статус", state.status?.value ?? "—");
  out("сумма", state.amount?.value ?? "—");
} else {
  out("тело", readText.slice(0, 300));
}

console.log("\nГотово. Заказ остался неоплаченным и истечёт сам через 30 минут.");
