import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// ================================================================
// PIN сотрудника.
//
// Четыре цифры — это 10 000 вариантов, поэтому защищает не длина, а
// блокировка после нескольких ошибок (lib/uchet/employee.ts) и то, что
// PIN вводится только на устройстве, уже вошедшем учётной записью
// магазина. Сам PIN нигде не хранится: в базе — scrypt-хэш с солью.
// ================================================================

const KEY_LENGTH = 32;

/** Совсем очевидные PIN не принимаем: их угадают с первой попытки. */
const OBVIOUS = new Set(["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234", "4321", "0123", "9876"]);

export function pinProblem(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return "PIN — ровно 4 цифры";
  if (OBVIOUS.has(pin)) return "Слишком простой PIN — его угадают. Выберите другой";
  return null;
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !/^\d{4}$/.test(pin)) return false;
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(pin, Buffer.from(saltB64, "base64"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
