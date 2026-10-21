// Должности людей за планшетом. Отдельно от lib/uchet/people.ts: этот
// модуль нужен и экрану в браузере, а тот ходит в базу служебным ключом.

export const POSITIONS = ["florist", "assistant", "admin", "owner", "courier"] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABEL: Record<Position, string> = {
  florist: "Флорист",
  assistant: "Помощник флориста",
  admin: "Администратор",
  owner: "Владелец",
  courier: "Курьер",
};
