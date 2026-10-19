// ================================================================
// Почему не проверяется сертификат платёжного шлюза.
//
// Узлов у ВТБ два, и доверие к ним разное: токен выдаётся одним хостом,
// а запросы идут на другой. Если наш набор корневых сертификатов покрывает
// только первый, всё выглядит обманчиво рабочим до самого платежа.
//
// Скрипт ничего не меняет: подключается, не проверяя подпись, и
// показывает, кем подписан сертификат каждого узла и что лежит у нас
// в хранилище доверия.
// ================================================================

import tls from "node:tls";
import fs from "node:fs";
import { X509Certificate } from "node:crypto";

function head(text) {
  console.log("\n=== " + text + " ===");
}

head("наше хранилище доверия");
const caPath = process.env.NODE_EXTRA_CA_CERTS;
console.log("  NODE_EXTRA_CA_CERTS: " + (caPath || "НЕ ЗАДАНА"));

if (caPath) {
  try {
    const pem = fs.readFileSync(caPath, "utf8");
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    console.log("  размер файла: " + pem.length + " байт, сертификатов: " + blocks.length);
    console.log("  заканчивается переводом строки: " + (pem.endsWith("\n") ? "да" : "НЕТ — Node молча проигнорирует файл"));
    blocks.forEach((b, i) => {
      try {
        const c = new X509Certificate(b);
        console.log(`  [${i + 1}] ${c.subject.replace(/\n/g, " | ").slice(0, 90)}`);
        console.log(`      действует до ${c.validTo}`);
      } catch (e) {
        console.log(`  [${i + 1}] НЕ РАЗОБРАЛСЯ: ${e.message}`);
      }
    });
  } catch (e) {
    console.log("  ФАЙЛ НЕ ПРОЧИТАЛСЯ: " + e.message);
  }
}

/** Подключаемся без проверки, только чтобы посмотреть, что отдаёт узел. */
function inspect(host, port) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: 12000 },
      () => {
        console.log("  соединение: установлено");
        console.log("  проверка подписи: " + (socket.authorized ? "прошла" : "НЕ ПРОШЛА — " + socket.authorizationError));

        let cert = socket.getPeerCertificate(true);
        let depth = 0;
        const seen = new Set();
        while (cert && cert.subject && !seen.has(cert.fingerprint256)) {
          seen.add(cert.fingerprint256);
          const subject = cert.subject.CN || cert.subject.O || "—";
          const issuer = cert.issuer?.CN || cert.issuer?.O || "—";
          console.log(`  [${depth}] кому: ${String(subject).slice(0, 60)}`);
          console.log(`      кем:  ${String(issuer).slice(0, 60)}`);
          console.log(`      до:   ${cert.valid_to}`);
          if (!cert.issuerCertificate || cert.issuerCertificate === cert) break;
          cert = cert.issuerCertificate;
          depth++;
        }
        console.log("  цепочка прислана узлом: " + (depth + 1) + " сертификат(ов)");
        socket.end();
        resolve();
      }
    );
    socket.on("timeout", () => { console.log("  СОЕДИНЕНИЕ НЕ ОТВЕТИЛО (таймаут)"); socket.destroy(); resolve(); });
    socket.on("error", (e) => { console.log("  ОШИБКА: " + e.message); resolve(); });
  });
}

for (const url of [process.env.VTB_TOKEN_URL, process.env.VTB_API_BASE]) {
  if (!url) continue;
  const parsed = new URL(url);
  head(`узел ${parsed.hostname}:${parsed.port || 443}`);
  await inspect(parsed.hostname, Number(parsed.port) || 443);
}
