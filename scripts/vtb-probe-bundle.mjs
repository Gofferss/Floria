// ================================================================
// Выясняем, в каком виде шлюз ВТБ ждёт товарную корзину.
//
// Корзина нужна для фискального чека по 54-ФЗ. Шлюз отверг наш вариант
// с подсказкой: цена и сумма позиции должны быть числом, а не объектом
// {value, code}, и обязателен taxParams. Какие поля внутри taxParams —
// в инструкции мы прочитать не смогли (текст PDF в нестандартной
// кодировке), поэтому спрашиваем сам шлюз: его отказы перечисляют
// недостающие поля поимённо.
//
// Только песочница: каждая попытка создаёт заказ на оплату.
// ================================================================

const base = (process.env.VTB_API_BASE ?? "").replace(/\/+$/, "");
if (!/test/i.test(base)) {
  console.log("ОТКАЗ: не песочница (" + base + ")");
  process.exit(1);
}

const tokenResponse = await fetch(process.env.VTB_TOKEN_URL, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.VTB_CLIENT_ID,
    client_secret: process.env.VTB_CLIENT_SECRET,
  }),
});
const { access_token } = await tokenResponse.json();

const headers = {
  Authorization: `Bearer ${access_token}`,
  "X-IBM-Client-Id": process.env.VTB_CLIENT_ID.split("@")[0].toLowerCase(),
  "Content-Type": "application/json",
  ...(process.env.VTB_MERCHANT_AUTH ? { "Merchant-Authorization": process.env.VTB_MERCHANT_AUTH } : {}),
};

/** Одна попытка: шлём корзину в заданном виде и печатаем, что ответил шлюз. */
async function attempt(label, item) {
  const orderId = "PROBE-" + Math.random().toString(36).slice(2, 10).toUpperCase();
  const response = await fetch(`${base}/v1/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      orderId,
      orderName: "Проверка корзины",
      expire: new Date(Date.now() + 10 * 60_000).toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z"),
      returnPaymentData: "sbp",
      amount: { value: 1, code: "RUB" },
      returnUrl: "https://floria-simferopol.ru/orders",
      customer: { customerId: orderId, phone: "79780000000", email: "test@floria-simferopol.ru" },
      bundle: { fiscalInfo: { clientEmail: "test@floria-simferopol.ru" }, items: [item] },
    }),
  });

  const text = await response.text();
  console.log("\n--- " + label + " -> HTTP " + response.status + " ---");
  if (response.ok) {
    const object = JSON.parse(text).object ?? {};
    console.log("  ПРИНЯТО. orderCode: " + (object.orderCode ?? "—"));
    console.log("  способы оплаты: " + (object.preparedPayments ?? []).map((p) => p.type).join(", ") || "только карта");
    return true;
  }
  try {
    console.log("  " + (JSON.parse(text).error ?? text).toString().replace(/;\s*/g, "\n  "));
  } catch {
    console.log("  " + text.slice(0, 400));
  }
  return false;
}

const basic = { positionId: 1, name: "Проверка связи", price: 1, quantity: 1, amount: 1 };

// Идём от пустого к заполненному: первый же отказ перечислит, чего не хватает.
const variants = [
  ["числа, без taxParams", basic],
  ["taxParams пустой", { ...basic, taxParams: {} }],
  ["taxParams.taxType", { ...basic, taxParams: { taxType: "NO_VAT" } }],
  ["taxParams.vatType", { ...basic, taxParams: { vatType: "NO_VAT" } }],
  ["taxParams.tax", { ...basic, taxParams: { tax: "NO_VAT" } }],
];

for (const [label, item] of variants) {
  const ok = await attempt(label, item);
  if (ok) break;
}
