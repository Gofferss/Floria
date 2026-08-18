/**
 * Posiflora хранит телефон РАЗДЕЛЬНО: countryCode (numeric, 7 для России)
 * + phone (локальный номер без кода страны, только цифры) — см. пример
 * в документации Customers API: {"countryCode": 7, "phone": "9268693654"}.
 * У нас телефон приходит в разных форматах ("+7 (978) 726-57-64",
 * "89787265764"...), поэтому нужна нормализация перед каждым обращением.
 *
 * Специфично для российских номеров — остальной проект тоже рассчитан
 * на РФ/Крым (Симферополь, СБП, Т-Pay), так что это не лишнее упрощение.
 */
export function splitPhoneForPosiflora(rawPhone: string): {
  countryCode: number;
  localNumber: string;
} {
  const digits = rawPhone.replace(/\D/g, "");

  let normalized = digits;
  if (normalized.length === 11 && (normalized[0] === "8" || normalized[0] === "7")) {
    normalized = "7" + normalized.slice(1);
  } else if (normalized.length === 10) {
    normalized = "7" + normalized;
  }

  if (normalized.length !== 11 || normalized[0] !== "7") {
    throw new Error(`Не удалось нормализовать номер телефона для Posiflora: "${rawPhone}"`);
  }

  return { countryCode: 7, localNumber: normalized.slice(1) };
}
