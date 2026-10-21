// ================================================================
// Кто куда может зайти.
//
// Вход — у человека или у устройства, а не «у роли»: у владельцев личные
// учётные записи, у айпада магазина — одна общая с ролью florist (люди за
// ним различаются по PIN, см. lib/uchet/employee.ts), у курьера — своя.
// Роль учётной записи решает, какие разделы ей открыты.
//
//   owner, admin — владельцы: всё, включая себестоимость и деньги;
//   manager      — сайт: каталог, блог, сторис, промокоды, заказы; в учёте
//                  рабочие разделы без себестоимости;
//   florist      — рабочие разделы учёта; из админки сайта — только заказы
//                  (пока заказы не переехали в учёт целиком);
//   courier      — только свои доставки.
//
// Проверка стоит и на страницах, и в серверных действиях: скрытая кнопка
// не защищает — действие можно вызвать и без неё.
// ================================================================

export const STAFF_ROLES = ["owner", "admin", "manager", "florist", "courier"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Владелец",
  admin: "Владелец",
  manager: "Менеджер сайта",
  florist: "Магазин / флорист",
  courier: "Курьер",
};

export const ROLE_HINT: Record<StaffRole, string> = {
  owner: "Всё: учёт, деньги, себестоимость, сотрудники, админка сайта",
  admin: "Всё: учёт, деньги, себестоимость, сотрудники, админка сайта",
  manager: "Админка сайта и рабочие разделы учёта, без себестоимости и денег",
  florist: "Касса, заказы, витрина, склад и смена. Без себестоимости и админки сайта",
  courier: "Только свои доставки",
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

const has = (role: string | null | undefined, allowed: readonly StaffRole[]) =>
  !!role && (allowed as readonly string[]).includes(role);

/** Владельцы: себестоимость, деньги, сотрудники, запуск учёта. */
export function isOwnerRole(role: string | null | undefined): boolean {
  return has(role, ["owner", "admin"]);
}

/** Админка сайта целиком: каталог, блог, сторис, промокоды, рассылка, метрики. */
export function canUseSiteAdmin(role: string | null | undefined): boolean {
  return has(role, ["owner", "admin", "manager"]);
}

/** Заказы с сайта в админке: флористу нужны, пока заказов нет в учёте. */
export function canUseSiteOrders(role: string | null | undefined): boolean {
  return has(role, ["owner", "admin", "manager", "florist"]);
}

/** Войти в приложение учёта вообще (курьер — в свой раздел). */
export function canEnterUchet(role: string | null | undefined): boolean {
  return has(role, STAFF_ROLES);
}

/** Рабочие разделы учёта: касса, заказы, витрина, склад, смена. */
export function canUseUchetWork(role: string | null | undefined): boolean {
  return has(role, ["owner", "admin", "manager", "florist"]);
}

/** Куда вести человека, которому сюда нельзя, — туда, где его работа. */
export function homePathFor(role: string | null | undefined): string {
  if (canUseSiteAdmin(role)) return "/admin";
  if (has(role, ["florist", "courier"])) return "/uchet";
  return "/";
}
