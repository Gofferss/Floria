"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaffAction } from "@/lib/auth/server";
import { canUseUchetWork } from "@/lib/auth/roles";
import { actorFor, checkApproval, issueApproval, verifyApprover } from "@/lib/uchet/employee";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { getOpenShift, getPosSettings, type CustomerHit } from "@/lib/uchet/pos-queries";

// ================================================================
// Действия торгового зала: смена, наличные, витрина, продажа.
//
// Вся арифметика — в базе (pos_* функции, миграция 028): там она атомарна
// и одна на планшет, админку и будущую работу без сети. Здесь — права,
// «кто делает» и понятные сообщения.
//
// Место — всегда основное (getDefaultLocation): пока учёт не запущен, это
// «Тренировка», и пробные продажи не попадают в настоящий журнал.
// ================================================================

type Result<T = undefined> = { success: true; data: T } | { success: false; error: string };

function dbMessage(error: { message?: string } | null | undefined, fallback: string): string {
  const message = error?.message?.trim();
  return message ? message : fallback;
}

async function who() {
  return actorFor(await requireStaffAction(canUseUchetWork));
}

function refresh() {
  revalidatePath("/uchet", "layout");
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

// ---------------------------------------------------------------
// Смена
// ---------------------------------------------------------------

export async function openShift(input: { id: string; cash: number }): Promise<Result<{ id: string }>> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  if (!isUuid(input.id)) return { success: false, error: "Нет идентификатора смены" };
  if (!Number.isFinite(input.cash) || input.cash < 0) return { success: false, error: "Сколько наличных в кассе — число, можно ноль" };

  const location = await getDefaultLocation();
  const { data, error } = await getSupabaseAdmin().rpc("pos_open_shift", {
    p_id: input.id,
    p_location: location.id,
    p_cash: input.cash,
    p_staff: w.actor.staff.id,
    p_employee: w.actor.employee?.id ?? null,
    p_device: null,
  });
  if (error || !data) return { success: false, error: dbMessage(error, "Не удалось открыть смену") };
  refresh();
  return { success: true, data: { id: data as string } };
}

export type CloseShiftResult = { expected: number; counted: number; diff: number };

export async function closeShift(input: { shiftId: string; counted: number; comment?: string }): Promise<Result<CloseShiftResult>> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  if (!Number.isFinite(input.counted) || input.counted < 0) return { success: false, error: "Сколько насчитали — число, можно ноль" };

  const { data, error } = await getSupabaseAdmin().rpc("pos_close_shift", {
    p_shift: input.shiftId,
    p_counted: input.counted,
    p_staff: w.actor.staff.id,
    p_employee: w.actor.employee?.id ?? null,
    p_comment: input.comment?.trim() || null,
  });
  if (error || !data) return { success: false, error: dbMessage(error, "Не удалось закрыть смену") };
  refresh();
  const r = data as { expected: number; counted: number; diff: number };
  return { success: true, data: { expected: Number(r.expected), counted: Number(r.counted), diff: Number(r.diff) } };
}

export type CashMoveInput = {
  id: string;
  shiftId: string;
  reasonId: string;
  amount: number;
  paidEmployeeId?: string | null;
  comment?: string;
};

/**
 * Внесение или изъятие. Закупка цветов из кассы сразу заводит черновик
 * прихода с оплатой «наличными из кассы» и связывает его с изъятием: деньги
 * ушли — осталось вписать, какие цветы пришли. Именно так чинятся минусы на
 * складе, которые сейчас копятся в Posiflora.
 */
export async function cashMove(input: CashMoveInput): Promise<Result<{ id: string; receiptDocId: string | null }>> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  if (!isUuid(input.id)) return { success: false, error: "Нет идентификатора движения" };
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { success: false, error: "Укажите сумму" };

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("pos_cash_move", {
    p_id: input.id,
    p_shift: input.shiftId,
    p_reason: input.reasonId,
    p_amount: input.amount,
    p_staff: w.actor.staff.id,
    p_employee: w.actor.employee?.id ?? null,
    p_paid_employee: input.paidEmployeeId || null,
    p_comment: input.comment?.trim() || null,
    p_device: null,
  });
  if (error || !data) return { success: false, error: dbMessage(error, "Не удалось записать движение наличных") };

  const { data: reason } = await admin.from("pos_cash_reasons").select("kind").eq("id", input.reasonId).maybeSingle();
  let receiptDocId: string | null = null;

  if (reason?.kind === "purchase") {
    const { data: existing } = await admin.from("pos_cash_movements").select("receipt_doc_id").eq("id", input.id).maybeSingle();
    receiptDocId = existing?.receipt_doc_id ?? null;
    if (!receiptDocId) {
      const amount = Math.round(input.amount).toLocaleString("ru-RU");
      const { data: doc, error: docError } = await admin.rpc("inv_save_draft", {
        p_doc: {
          doc_type: "receipt",
          payment_method: "cash",
          comment: `Закупка из кассы на ${amount} ₽${input.comment?.trim() ? ` · ${input.comment.trim()}` : ""}`,
        },
        p_lines: [],
        p_staff: w.actor.staff.id,
      });
      if (!docError && doc) {
        receiptDocId = doc as string;
        await admin.from("pos_cash_movements").update({ receipt_doc_id: receiptDocId }).eq("id", input.id);
        if (w.actor.employee) await admin.from("inv_documents").update({ employee_id: w.actor.employee.id }).eq("id", receiptDocId);
      }
    }
  }

  refresh();
  return { success: true, data: { id: data as string, receiptDocId } };
}

// ---------------------------------------------------------------
// Витрина
// ---------------------------------------------------------------

export type CompositionLine = { itemId: string; qty: number };

function validComposition(items: CompositionLine[]): string | null {
  for (const [i, l] of items.entries()) {
    if (!isUuid(l.itemId)) return `Строка ${i + 1}: позиция не выбрана`;
    if (!Number.isFinite(l.qty) || l.qty <= 0) return `Строка ${i + 1}: количество больше нуля`;
  }
  return null;
}

export async function assembleBouquet(input: {
  id: string;
  title: string;
  price: number;
  items: CompositionLine[];
  photoUrls: string[];
  /** Собрать к заказу магазина, а не на витрину. */
  orderId?: string | null;
}): Promise<Result<{ id: string }>> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  if (!isUuid(input.id)) return { success: false, error: "Нет идентификатора букета" };
  if (!Number.isFinite(input.price) || input.price <= 0) return { success: false, error: "Укажите цену букета" };
  if (input.items.length === 0) return { success: false, error: "Добавьте в букет цветы" };
  const bad = validComposition(input.items);
  if (bad) return { success: false, error: bad };

  const location = await getDefaultLocation();
  const { data, error } = await getSupabaseAdmin().rpc("pos_assemble_bouquet", {
    p_bouquet: {
      id: input.id,
      title: input.title.trim() || null,
      price: input.price,
      photo_urls: input.photoUrls.slice(0, 10),
      order_id: input.orderId || null,
    },
    p_items: input.items.map((l) => ({ item_id: l.itemId, qty: l.qty })),
    p_location: location.id,
    p_staff: w.actor.staff.id,
    p_employee: w.actor.employee?.id ?? null,
  });
  if (error || !data) return { success: false, error: dbMessage(error, "Не удалось поставить букет на витрину") };
  refresh();
  return { success: true, data: { id: data as string } };
}

export async function disassembleBouquet(id: string): Promise<Result> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  const { error } = await getSupabaseAdmin().rpc("pos_disassemble_bouquet", {
    p_bouquet: id,
    p_staff: w.actor.staff.id,
    p_employee: w.actor.employee?.id ?? null,
  });
  if (error) return { success: false, error: dbMessage(error, "Не удалось разобрать букет") };
  refresh();
  return { success: true, data: undefined };
}

export async function writeoffBouquet(id: string, reason: string): Promise<Result> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  const { error } = await getSupabaseAdmin().rpc("pos_writeoff_bouquet", {
    p_bouquet: id,
    p_staff: w.actor.staff.id,
    p_employee: w.actor.employee?.id ?? null,
    p_reason: reason.trim() || null,
  });
  if (error) return { success: false, error: dbMessage(error, "Не удалось списать букет") };
  refresh();
  return { success: true, data: undefined };
}

export async function updateVitrineBouquet(id: string, patch: { title?: string; price?: number; photoUrls?: string[] }): Promise<Result> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    if (!patch.title.trim()) return { success: false, error: "Название не может быть пустым" };
    row.title = patch.title.trim();
  }
  if (patch.price !== undefined) {
    if (!Number.isFinite(patch.price) || patch.price <= 0) return { success: false, error: "Цена — больше нуля" };
    row.price = Math.round(patch.price * 100) / 100;
  }
  if (patch.photoUrls !== undefined) row.photo_urls = patch.photoUrls.slice(0, 10);
  if (Object.keys(row).length === 0) return { success: true, data: undefined };

  const { error } = await getSupabaseAdmin().from("pos_bouquets").update(row).eq("id", id);
  if (error) return { success: false, error: dbMessage(error, "Не удалось сохранить") };
  refresh();
  return { success: true, data: undefined };
}

const PHOTO_BUCKET = "product-images";
const MAX_PHOTO_SIZE = 8 * 1024 * 1024;

/** Фото букета. Файл уже ужат в браузере (lib/prepare-image.ts). */
export async function uploadBouquetPhoto(formData: FormData): Promise<Result<{ url: string }>> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { success: false, error: "Файл не выбран" };
  if (!file.type.startsWith("image/")) return { success: false, error: "Можно загружать только фотографии" };
  if (file.size > MAX_PHOTO_SIZE) return { success: false, error: "Фото больше 8 МБ" };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `vitrine/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  const admin = getSupabaseAdmin();
  const { error } = await admin.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (error) return { success: false, error: "Не удалось загрузить фото" };
  const { data } = admin.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return { success: true, data: { url: data.publicUrl } };
}

// ---------------------------------------------------------------
// Продажа
// ---------------------------------------------------------------

export type SaleLineInput =
  | { kind: "bouquet"; id: string; title: string; price: number; items: CompositionLine[] }
  | { kind: "vitrine"; bouquetId: string }
  | { kind: "item"; itemId: string; qty: number; price: number }
  /** Оплата заказа магазина: предоплата, доплата или остаток — отдельным чеком. */
  | { kind: "order"; orderId: string; amount: number };

export type SaleInput = {
  id: string;
  customerId: string | null;
  discountPercent: number;
  approval: string | null;
  comment: string | null;
  lines: SaleLineInput[];
  payments: { method: string; amount: number }[];
  /** Сколько оплатить бонусами клиента (целые рубли). База проверит баланс и долю чека. */
  bonusUsed?: number;
};

export async function recordSale(input: SaleInput): Promise<Result<{ saleNo: string; repeated: boolean; bonusUsed: number; bonusEarned: number }>> {
  const w = await who();
  if (!w.ok) return { success: false, error: w.error };
  if (!isUuid(input.id)) return { success: false, error: "Нет идентификатора чека" };
  if (input.lines.length === 0) return { success: false, error: "Чек пуст" };

  const location = await getDefaultLocation();
  const shift = await getOpenShift(location.id);
  if (!shift) return { success: false, error: "Смена не открыта — откройте смену, потом продавайте" };

  for (const l of input.lines) {
    if (l.kind === "bouquet") {
      if (!Number.isFinite(l.price) || l.price < 0) return { success: false, error: "У букета нет цены" };
      const bad = validComposition(l.items);
      if (bad) return { success: false, error: bad };
    } else if (l.kind === "item") {
      if (!isUuid(l.itemId) || !Number.isFinite(l.qty) || l.qty <= 0) return { success: false, error: "Неверная строка чека" };
    } else if (l.kind === "order") {
      if (!isUuid(l.orderId) || !Number.isFinite(l.amount) || l.amount <= 0) return { success: false, error: "Укажите сумму оплаты заказа" };
    } else if (!isUuid(l.bouquetId)) {
      return { success: false, error: "Неверный букет витрины" };
    }
  }

  // Скидка сверх лимита — только по допуску того, кому можно. Допуск
  // проверяем здесь: база верит approved_by, значит, подделать его нельзя
  // давать браузеру.
  const settings = await getPosSettings();
  let approvedBy: string | null = null;
  if (input.discountPercent > settings.discountLimitPercent) {
    approvedBy = checkApproval(input.approval, input.discountPercent, w.actor.staff.id);
    if (!approvedBy) return { success: false, error: `Скидка больше ${settings.discountLimitPercent}% — нужно подтверждение администратора` };
  }

  const { data, error } = await getSupabaseAdmin().rpc("pos_record_sale", {
    p_sale: {
      id: input.id,
      shift_id: shift.id,
      customer_id: input.customerId || null,
      discount_percent: input.discountPercent || 0,
      approved_by: approvedBy,
      comment: input.comment?.trim() || null,
      bonus_used: Math.max(0, Math.floor(Number(input.bonusUsed) || 0)),
    },
    p_lines: input.lines.map((l) =>
      l.kind === "bouquet"
        ? { kind: "bouquet", id: l.id, title: l.title, price: l.price, items: l.items.map((i) => ({ item_id: i.itemId, qty: i.qty })) }
        : l.kind === "vitrine"
          ? { kind: "vitrine", bouquet_id: l.bouquetId }
          : l.kind === "order"
            ? { kind: "order", order_id: l.orderId, amount: l.amount }
            : { kind: "item", item_id: l.itemId, qty: l.qty, price: l.price }
    ),
    p_payments: input.payments.filter((p) => p.amount > 0).map((p) => ({ method: p.method, amount: p.amount })),
    p_staff: w.actor.staff.id,
    p_employee: w.actor.employee?.id ?? null,
  });
  if (error || !data) return { success: false, error: dbMessage(error, "Не удалось провести продажу") };

  refresh();
  const r = data as { sale_no: string; repeated: boolean; bonus_used?: number | string; bonus_earned?: number | string };
  return { success: true, data: { saleNo: r.sale_no, repeated: r.repeated, bonusUsed: Number(r.bonus_used) || 0, bonusEarned: Number(r.bonus_earned) || 0 } };
}

/** Проверить PIN того, кто разрешает скидку, и выдать допуск до оплаты. */
export async function approveDiscount(employeeId: string, pin: string, percent: number): Promise<Result<{ approval: string }>> {
  const staff = await requireStaffAction(canUseUchetWork);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return { success: false, error: "Скидка — от 1 до 100%" };
  const checked = await verifyApprover(employeeId, pin);
  if (!checked.ok) return { success: false, error: checked.error };
  return { success: true, data: { approval: issueApproval(employeeId, percent, staff.id) } };
}

/** Клиент по части телефона — для бонусов и истории. */
export async function searchCustomers(query: string): Promise<CustomerHit[]> {
  await requireStaffAction(canUseUchetWork);
  const digits = query.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7");
  if (digits.length < 4) return [];

  const { data } = await getSupabaseAdmin()
    .from("customers")
    .select("id, full_name, phone, bonus_balance, orders(created_at)")
    .like("phone", `%${digits.slice(-10)}%`)
    .order("created_at", { referencedTable: "orders", ascending: false })
    .limit(1, { referencedTable: "orders" })
    .limit(8);

  type Row = { id: string; full_name: string | null; phone: string; bonus_balance: number | string | null; orders: { created_at: string }[] | null };
  return ((data ?? []) as Row[]).map((c) => ({
    id: c.id,
    name: c.full_name,
    phone: c.phone,
    bonusBalance: Number(c.bonus_balance) || 0,
    lastOrderAt: c.orders?.[0]?.created_at ?? null,
  }));
}
