// ================================================================
// Достаёт недостающий промежуточный сертификат НУЦ и доказывает, что
// именно он подписал узел платёжного API.
//
// Зачем. Узел test3.api.vtb.ru присылает только свой сертификат, без
// промежуточного — так делать можно, но тогда промежуточный обязан быть
// у клиента. У нас лежит подчинённый центр со сроком до марта 2027, а
// узел подписан другим, со сроком до июля 2029: имя то же, сертификат
// другой. Отсюда UNABLE_TO_VERIFY_LEAF_SIGNATURE.
//
// Берём нужный не со стороннего сайта, а из цепочки, которую присылает
// сам узел выдачи токена — она уже проверена по корневому НУЦ. И не
// верим на слово: проверяем подписью, что этот центр действительно
// выпустил сертификат платёжного узла.
// ================================================================

import tls from "node:tls";
import { X509Certificate } from "node:crypto";

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: 12000 },
      () => {
        const cert = socket.getPeerCertificate(true);
        socket.end();
        resolve(cert);
      }
    );
    socket.on("timeout", () => { socket.destroy(); reject(new Error("таймаут " + host)); });
    socket.on("error", reject);
  });
}

function toPem(der) {
  const b64 = der.toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

const tokenUrl = new URL(process.env.VTB_TOKEN_URL);
const apiUrl = new URL(process.env.VTB_API_BASE);

// --- промежуточный из цепочки узла выдачи токена ---
const tokenLeaf = await connect(tokenUrl.hostname, Number(tokenUrl.port) || 443);
const subCa = tokenLeaf.issuerCertificate;
if (!subCa || subCa === tokenLeaf) {
  console.log("Узел токена не прислал промежуточный — взять неоткуда.");
  process.exit(1);
}

const subPem = toPem(subCa.raw);
const subX509 = new X509Certificate(subPem);

console.log("=== промежуточный центр ===");
console.log("  кому: " + subX509.subject.replace(/\n/g, " | "));
console.log("  кем:  " + subX509.issuer.replace(/\n/g, " | "));
console.log("  срок: " + subX509.validFrom + "  —  " + subX509.validTo);

// --- сертификат платёжного узла ---
const apiLeaf = await connect(apiUrl.hostname, Number(apiUrl.port) || 443);
const apiX509 = new X509Certificate(toPem(apiLeaf.raw));

console.log("\n=== узел платёжного API ===");
console.log("  кому: " + apiX509.subject.replace(/\n/g, " | "));
console.log("  кем:  " + apiX509.issuer.replace(/\n/g, " | "));

// Главная проверка: подпись, а не совпадение имён. Имена у этих центров
// одинаковые, и доверять им нельзя — отличаются именно ключи.
const signedByThisCa = apiX509.verify(subX509.publicKey);
console.log("\n  подписан этим центром: " + (signedByThisCa ? "ДА" : "НЕТ"));

if (!signedByThisCa) {
  console.log("  Значит, нужен другой промежуточный — этот не подойдёт.");
  process.exit(1);
}

console.log("\n=== PEM для certs/russian-trusted-ca.pem ===");
console.log(subPem);
