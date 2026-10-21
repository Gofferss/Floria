"use server";

import { revalidatePath } from "next/cache";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canPostOpening } from "@/lib/uchet/access";
import { KINDS, PAYMENT_METHODS, type DocType, type GroupKind, type PaymentMethod } from "@/lib/uchet/format";

// ================================================================
// Действия склада.
//
// Вся арифметика остатков и себестоимости — в базе (inv_save_draft,
// inv_post_document, inv_reverse_document): там она атомарна и одна на
// всех — админку, будущий планшет и бота. Здесь только проверка прав,
// подготовка данных и понятные сообщения об ошибках.
//
// Сообщения функций базы уже написаны по-русски для человека
// («Строка 2: в приходе нужна цена закупки»), поэтому отдаём их как есть.
// ================================================================

type Result<T = undefined> = { success: true; data: T } | { success: false; error: string };

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

function dbMessage(error: { message?: string } | null | undefined, fallback: string): string {
  const message = error?.message?.trim();
  return message ? message : fallback;
}

function revalidateSklad() {
  revalidatePath("/admin/sklad", "layout");
}

function optionalNumber(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

// ---------------------------------------------------------------
// Позиции
// ---------------------------------------------------------------

export type ItemInput = {
  id?: string;
  title: string;
  groupId: string | null;
  unitCode: string;
  fractional: boolean;
  isTracked: boolean;
  salePrice: number | null;
  minQty: number | null;
  freshDays: number | null;
  barcode: string | null;
  notes: string | null;
  isActive: boolean;
};

export async function saveItem(input: ItemInput): Promise<Result<{ id: string }>> {
  await requireStaff();

  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) return { success: false, error: "Укажите название" };

  const salePrice = optionalNumber(input.salePrice);
  const minQty = optionalNumber(input.minQty);
  const freshDays = optionalNumber(input.freshDays);
  if (salePrice !== null && salePrice < 0) return { success: false, error: "Цена не может быть отрицательной" };
  if (minQty !== null && minQty < 0) return { success: false, error: "Минимальный остаток не может быть отрицательным" };
  if (freshDays !== null && (freshDays <= 0 || !Number.isInteger(freshDays))) {
    return { success: false, error: "Срок свежести — целое число дней больше нуля" };
  }

  const row = {
    title,
    group_id: input.groupId || null,
    unit_code: input.unitCode || "pcs",
    fractional: input.fractional,
    is_tracked: input.isTracked,
    sale_price: salePrice,
    min_qty: minQty,
    fresh_days: freshDays,
    barcode: input.barcode?.trim() || null,
    notes: input.notes?.trim() || null,
    is_active: input.isActive,
  };

  const admin = getSupabaseAdmin();
  const { data, error } = input.id
    ? await admin.from("inv_items").update(row).eq("id", input.id).select("id").maybeSingle()
    : await admin.from("inv_items").insert(row).select("id").maybeSingle();

  if (error || !data) return { success: false, error: dbMessage(error, "Не удалось сохранить позицию") };

  revalidateSklad();
  return { success: true, data: { id: data.id } };
}

// ---------------------------------------------------------------
// Документы
// ---------------------------------------------------------------

export type DraftLineInput = { itemId: string; qty: number; unitCost: number | null };

export type DraftInput = {
  id?: string;
  docType: DocType;
  docDate: string | null;
  supplierId: string | null;
  writeoffReasonId: string | null;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
  lines: DraftLineInput[];
};

function validateDraft(input: DraftInput): string | null {
  if (input.lines.length === 0) return "Добавьте хотя бы одну позицию";
  for (const [i, line] of input.lines.entries()) {
    const n = i + 1;
    if (!line.itemId) return `Строка ${n}: выберите позицию`;
    if (!Number.isFinite(line.qty) || line.qty < 0) return `Строка ${n}: количество не может быть отрицательным`;
    if (input.docType !== "inventory" && line.qty === 0) return `Строка ${n}: укажите количество`;
    if (input.docType === "receipt" && (line.unitCost === null || !Number.isFinite(line.unitCost) || line.unitCost < 0)) {
      return `Строка ${n}: укажите цену закупки`;
    }
  }
  const ids = input.lines.map((l) => l.itemId);
  if (new Set(ids).size !== ids.length) return "Одна позиция встречается в документе дважды — объедините строки";
  if (input.docType === "writeoff" && !input.writeoffReasonId) return "Укажите причину списания";
  if (input.paymentMethod && !PAYMENT_METHODS.includes(input.paymentMethod)) return "Неизвестный способ оплаты";
  return null;
}

export async function saveDraft(input: DraftInput): Promise<Result<{ id: string }>> {
  const staff = await requireStaff();

  if (input.docType === "opening" && !canPostOpening(staff.role)) {
    return { success: false, error: "Начальный остаток вводит только владелец" };
  }
  const invalid = validateDraft(input);
  if (invalid) return { success: false, error: invalid };

  const { data, error } = await getSupabaseAdmin().rpc("inv_save_draft", {
    p_doc: {
      id: input.id ?? null,
      doc_type: input.docType,
      doc_date: input.docDate || null,
      supplier_id: input.supplierId || null,
      writeoff_reason_id: input.writeoffReasonId || null,
      payment_method: input.paymentMethod || null,
      comment: input.comment ?? null,
    },
    p_lines: input.lines.map((l) => ({
      item_id: l.itemId,
      qty: l.qty,
      unit_cost: l.unitCost,
    })),
    p_staff: staff.id,
  });

  if (error || !data) return { success: false, error: dbMessage(error, "Не удалось сохранить документ") };

  revalidateSklad();
  return { success: true, data: { id: data as string } };
}

/**
 * Сохранить и сразу провести. Если сохранение прошло, а проведение — нет
 * (база отклонила по существу), черновик остаётся: человек видит ошибку и
 * правит, а не вводит всё заново.
 */
export async function saveAndPost(input: DraftInput): Promise<Result<{ id: string }> & { id?: string }> {
  const saved = await saveDraft(input);
  if (!saved.success) return saved;

  const posted = await postDocument(saved.data.id);
  if (!posted.success) return { success: false, error: posted.error, id: saved.data.id };
  return { success: true, data: { id: saved.data.id } };
}

export async function postDocument(id: string): Promise<Result> {
  const staff = await requireStaff();
  const admin = getSupabaseAdmin();

  const { data: doc } = await admin.from("inv_documents").select("doc_type").eq("id", id).maybeSingle();
  if (doc?.doc_type === "opening" && !canPostOpening(staff.role)) {
    return { success: false, error: "Начальный остаток проводит только владелец" };
  }

  const { error } = await admin.rpc("inv_post_document", { p_doc: id, p_staff: staff.id });
  if (error) return { success: false, error: dbMessage(error, "Не удалось провести документ") };

  revalidateSklad();
  return { success: true, data: undefined };
}

export async function reverseDocument(id: string, comment: string): Promise<Result<{ id: string }>> {
  const staff = await requireStaff();

  const { data, error } = await getSupabaseAdmin().rpc("inv_reverse_document", {
    p_doc: id,
    p_staff: staff.id,
    p_comment: comment.trim() || null,
  });
  if (error || !data) return { success: false, error: dbMessage(error, "Не удалось сторнировать документ") };

  revalidateSklad();
  return { success: true, data: { id: data as string } };
}

export async function deleteDraft(id: string): Promise<Result> {
  await requireStaff();

  // Проведённый документ база удалить не даст (триггер), но и попытку
  // делаем только для черновика — чтобы сообщение было понятным.
  const { data: doc } = await getSupabaseAdmin().from("inv_documents").select("status, doc_no").eq("id", id).maybeSingle();
  if (!doc) return { success: false, error: "Документ не найден" };
  if (doc.status !== "draft") return { success: false, error: `${doc.doc_no} проведён — удалить нельзя, только сторно` };

  const { error } = await getSupabaseAdmin().from("inv_documents").delete().eq("id", id);
  if (error) return { success: false, error: dbMessage(error, "Не удалось удалить черновик") };

  revalidateSklad();
  return { success: true, data: undefined };
}

// ---------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------

export type GroupInput = { id?: string; title: string; kind: GroupKind; isActive: boolean };

export async function saveGroup(input: GroupInput): Promise<Result<{ id: string }>> {
  await requireStaff();
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) return { success: false, error: "Укажите название группы" };
  if (!KINDS.includes(input.kind)) return { success: false, error: "Неизвестный вид группы" };

  const admin = getSupabaseAdmin();
  const row = { title, kind: input.kind, is_active: input.isActive };
  const { data, error } = input.id
    ? await admin.from("inv_groups").update(row).eq("id", input.id).select("id").maybeSingle()
    : await admin.from("inv_groups").insert(row).select("id").maybeSingle();

  if (error || !data) {
    const duplicate = error?.message?.includes("duplicate");
    return { success: false, error: duplicate ? "Группа с таким названием уже есть" : dbMessage(error, "Не удалось сохранить группу") };
  }
  revalidateSklad();
  return { success: true, data: { id: data.id } };
}

export type SupplierInput = { id?: string; title: string; phone: string | null; notes: string | null; isActive: boolean };

export async function saveSupplier(input: SupplierInput): Promise<Result<{ id: string }>> {
  await requireStaff();
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) return { success: false, error: "Укажите название поставщика" };

  const admin = getSupabaseAdmin();
  const row = { title, phone: input.phone?.trim() || null, notes: input.notes?.trim() || null, is_active: input.isActive };
  const { data, error } = input.id
    ? await admin.from("inv_suppliers").update(row).eq("id", input.id).select("id").maybeSingle()
    : await admin.from("inv_suppliers").insert(row).select("id").maybeSingle();

  if (error || !data) {
    const duplicate = error?.message?.includes("duplicate");
    return { success: false, error: duplicate ? "Такой поставщик уже есть" : dbMessage(error, "Не удалось сохранить поставщика") };
  }
  revalidateSklad();
  return { success: true, data: { id: data.id } };
}

export type ReasonInput = { id?: string; title: string; isActive: boolean };

export async function saveReason(input: ReasonInput): Promise<Result<{ id: string }>> {
  await requireStaff();
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) return { success: false, error: "Укажите причину" };

  const admin = getSupabaseAdmin();
  const row = { title, is_active: input.isActive };
  const { data, error } = input.id
    ? await admin.from("inv_writeoff_reasons").update(row).eq("id", input.id).select("id").maybeSingle()
    : await admin.from("inv_writeoff_reasons").insert({ ...row, sort: 80 }).select("id").maybeSingle();

  if (error || !data) {
    const duplicate = error?.message?.includes("duplicate");
    return { success: false, error: duplicate ? "Такая причина уже есть" : dbMessage(error, "Не удалось сохранить причину") };
  }
  revalidateSklad();
  return { success: true, data: { id: data.id } };
}
