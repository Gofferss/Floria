"use server";

import { revalidatePath } from "next/cache";
import { requireStaffAction } from "@/lib/auth/server";
import { canUseUchetWork } from "@/lib/auth/roles";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canPostOpening, canSeeCosts } from "@/lib/uchet/access";
import { actorFor } from "@/lib/uchet/employee";
import { guessGroupIcon, isGroupIconKey } from "@/components/uchet/GroupIcon";
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
  return requireStaffAction(canUseUchetWork);
}

/**
 * Кто делает: учётная запись и человек за планшетом. На общей учётной
 * записи магазина без выбранного человека действие не выполняется — иначе
 * в журнале остались бы документы «ничьи». Ошибку возвращаем значением, а
 * не исключением: текст исключения сервер в браузер не передаёт.
 */
async function requireActor() {
  return actorFor(await requireStaff());
}

function dbMessage(error: { message?: string } | null | undefined, fallback: string): string {
  const message = error?.message?.trim();
  return message ? message : fallback;
}

function revalidateSklad() {
  revalidatePath("/uchet", "layout");
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
  const who = await requireActor();
  if (!who.ok) return { success: false, error: who.error };
  const { staff, employee } = who.actor;

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

  // Человек за планшетом — отдельной записью: черновик ещё можно менять.
  if (employee) {
    await getSupabaseAdmin().from("inv_documents").update({ employee_id: employee.id }).eq("id", data as string).eq("status", "draft");
  }

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
  const who = await requireActor();
  if (!who.ok) return { success: false, error: who.error };
  const { staff } = who.actor;
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
  const who = await requireActor();
  if (!who.ok) return { success: false, error: who.error };
  const { staff } = who.actor;

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

export type GroupInput = { id?: string; title: string; kind: GroupKind; icon?: string | null; isActive: boolean };

export async function saveGroup(input: GroupInput): Promise<Result<{ id: string }>> {
  await requireStaff();
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) return { success: false, error: "Укажите название группы" };
  if (!KINDS.includes(input.kind)) return { success: false, error: "Неизвестный вид группы" };
  if (input.icon && !isGroupIconKey(input.icon)) return { success: false, error: "Неизвестный значок" };

  const admin = getSupabaseAdmin();
  // Значок не выбран — подбираем по названию, чтобы новая группа не
  // осталась безликой.
  const icon = input.icon || (input.id ? undefined : guessGroupIcon(title, input.kind));
  const row = { title, kind: input.kind, is_active: input.isActive, ...(icon ? { icon } : {}) };
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

// ---------------------------------------------------------------
// Быстрые действия из списка — не заходя в позицию
// ---------------------------------------------------------------

/**
 * Одна позиция — одно действие: «списать 3, завяли». Внутри это обычный
 * документ из одной строки, сразу проведённый. Так журнал остаётся
 * честным (у каждого изменения есть номер и автор), а человеку не нужно
 * открывать форму документа ради одной строки.
 */
export type QuickAction =
  | { kind: "writeoff"; itemId: string; qty: number; reasonId: string; comment?: string }
  | { kind: "receipt"; itemId: string; qty: number; unitCost: number; paymentMethod: PaymentMethod | null; supplierId?: string | null }
  | { kind: "count"; itemId: string; counted: number };

export async function quickAction(action: QuickAction): Promise<Result<{ id: string; docNo: string }>> {
  const base: Omit<DraftInput, "docType" | "lines"> = {
    docDate: null,
    supplierId: null,
    writeoffReasonId: null,
    paymentMethod: null,
    comment: null,
  };

  let input: DraftInput;
  if (action.kind === "writeoff") {
    input = {
      ...base,
      docType: "writeoff",
      writeoffReasonId: action.reasonId,
      comment: action.comment?.trim() || null,
      lines: [{ itemId: action.itemId, qty: action.qty, unitCost: null }],
    };
  } else if (action.kind === "receipt") {
    input = {
      ...base,
      docType: "receipt",
      paymentMethod: action.paymentMethod,
      supplierId: action.supplierId ?? null,
      lines: [{ itemId: action.itemId, qty: action.qty, unitCost: action.unitCost }],
    };
  } else {
    input = {
      ...base,
      docType: "inventory",
      comment: "Пересчёт одной позиции",
      lines: [{ itemId: action.itemId, qty: action.counted, unitCost: null }],
    };
  }

  const result = await saveAndPost(input);
  if (!result.success) return { success: false, error: result.error };

  const { data } = await getSupabaseAdmin().from("inv_documents").select("doc_no").eq("id", result.data.id).maybeSingle();
  return { success: true, data: { id: result.data.id, docNo: data?.doc_no ?? "" } };
}

export type ItemPatch = Partial<{
  salePrice: number | null;
  minQty: number | null;
  freshDays: number | null;
  groupId: string | null;
  isActive: boolean;
  title: string;
}>;

/** Поправить одно-два поля позиции прямо из панели, без формы целиком. */
export async function patchItem(id: string, patch: ItemPatch): Promise<Result> {
  await requireStaff();

  const row: Record<string, unknown> = {};
  if ("title" in patch) {
    const title = (patch.title ?? "").replace(/\s+/g, " ").trim();
    if (!title) return { success: false, error: "Название не может быть пустым" };
    row.title = title;
  }
  if ("salePrice" in patch) {
    const v = optionalNumber(patch.salePrice);
    if (v !== null && v < 0) return { success: false, error: "Цена не может быть отрицательной" };
    row.sale_price = v;
  }
  if ("minQty" in patch) {
    const v = optionalNumber(patch.minQty);
    if (v !== null && v < 0) return { success: false, error: "Минимум не может быть отрицательным" };
    row.min_qty = v;
  }
  if ("freshDays" in patch) {
    const v = optionalNumber(patch.freshDays);
    if (v !== null && (v <= 0 || !Number.isInteger(v))) return { success: false, error: "Срок свежести — целое число дней больше нуля" };
    row.fresh_days = v;
  }
  if ("groupId" in patch) row.group_id = patch.groupId || null;
  if ("isActive" in patch) row.is_active = !!patch.isActive;
  if (Object.keys(row).length === 0) return { success: true, data: undefined };

  const { error } = await getSupabaseAdmin().from("inv_items").update(row).eq("id", id);
  if (error) return { success: false, error: dbMessage(error, "Не удалось сохранить") };

  revalidateSklad();
  return { success: true, data: undefined };
}

/** Массовые правки отмеченных позиций — только владельцу. */
export async function bulkUpdateItems(
  ids: string[],
  patch: { groupId?: string | null; isActive?: boolean }
): Promise<Result<{ count: number }>> {
  const staff = await requireStaff();
  if (!canSeeCosts(staff.role)) return { success: false, error: "Массовые правки доступны владельцу" };
  if (ids.length === 0) return { success: false, error: "Ничего не отмечено" };
  if (ids.length > 1000) return { success: false, error: "Слишком много позиций за раз" };

  const row: Record<string, unknown> = {};
  if ("groupId" in patch) row.group_id = patch.groupId || null;
  if ("isActive" in patch) row.is_active = !!patch.isActive;
  if (Object.keys(row).length === 0) return { success: false, error: "Нечего менять" };

  const { error, count } = await getSupabaseAdmin()
    .from("inv_items")
    .update(row, { count: "exact" })
    .in("id", ids);
  if (error) return { success: false, error: dbMessage(error, "Не удалось сохранить") };

  revalidateSklad();
  return { success: true, data: { count: count ?? ids.length } };
}

/**
 * Запуск учёта: основное место хранения — «Магазин» вместо «Тренировки».
 * После этого все документы идут в настоящий журнал. Только владельцу.
 */
export async function setDefaultLocation(locationId: string): Promise<Result> {
  const staff = await requireStaff();
  if (!canSeeCosts(staff.role)) return { success: false, error: "Запускать учёт может только владелец" };

  const { error } = await getSupabaseAdmin().rpc("inv_set_default_location", { p_location: locationId });
  if (error) return { success: false, error: dbMessage(error, "Не удалось переключить место хранения") };

  revalidatePath("/uchet", "layout");
  return { success: true, data: undefined };
}

// ---------------------------------------------------------------
// Фото позиции
// ---------------------------------------------------------------

const ITEM_PHOTO_BUCKET = "product-images";
const MAX_ITEM_PHOTO_SIZE = 8 * 1024 * 1024;

/**
 * Фото позиции — чтобы в кассе и на складе находить её глазами. Файл уже
 * ужат в браузере (lib/prepare-image.ts). Старое фото в хранилище не
 * удаляем: его могли перенести из Posiflora, и оно может понадобиться.
 */
export async function uploadItemPhoto(itemId: string, formData: FormData): Promise<Result<{ url: string }>> {
  await requireStaff();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { success: false, error: "Файл не выбран" };
  if (!file.type.startsWith("image/")) return { success: false, error: "Можно загружать только фотографии" };
  if (file.size > MAX_ITEM_PHOTO_SIZE) return { success: false, error: "Фото больше 8 МБ" };

  const admin = getSupabaseAdmin();
  const { data: item } = await admin.from("inv_items").select("id").eq("id", itemId).maybeSingle();
  if (!item) return { success: false, error: "Позиция не найдена" };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `inventory/${itemId}-${Date.now()}.${ext}`;
  const { error: upError } = await admin.storage.from(ITEM_PHOTO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (upError) return { success: false, error: "Не удалось загрузить фото" };
  const { data } = admin.storage.from(ITEM_PHOTO_BUCKET).getPublicUrl(path);

  const { error } = await admin.from("inv_items").update({ photo_url: data.publicUrl }).eq("id", itemId);
  if (error) return { success: false, error: "Фото загрузилось, но не привязалось к позиции" };

  revalidateSklad();
  return { success: true, data: { url: data.publicUrl } };
}

export async function removeItemPhoto(itemId: string): Promise<Result> {
  await requireStaff();
  const { error } = await getSupabaseAdmin().from("inv_items").update({ photo_url: null }).eq("id", itemId);
  if (error) return { success: false, error: "Не удалось убрать фото" };
  revalidateSklad();
  return { success: true, data: undefined };
}
