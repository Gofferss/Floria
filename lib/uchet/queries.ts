import { getSupabaseAdmin } from "@/lib/supabase";
import type { DocStatus, DocType, GroupKind, PaymentMethod } from "@/lib/uchet/format";

// ================================================================
// Чтение склада для админки.
//
// Каждая функция получает withCosts: если false, поля себестоимости в
// результат НЕ попадают вовсе (null), а не просто прячутся на экране.
// Иначе цифры уехали бы в браузер флориста в данных страницы.
// ================================================================

/** Supabase отдаёт связанную запись объектом или массивом — приводим к одному. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------
// Место хранения
// ---------------------------------------------------------------

export type LocationInfo = { id: string; title: string; isTraining: boolean };

/**
 * Основное место хранения. Пока учёт не запущен, это «Тренировка»: все
 * документы попадают туда и не смешиваются с настоящим журналом.
 */
export async function getDefaultLocation(): Promise<LocationInfo> {
  const { data, error } = await getSupabaseAdmin()
    .from("inv_locations")
    .select("id, title, is_training")
    .eq("is_default", true)
    .maybeSingle();
  if (error || !data) throw new Error(`Место хранения по умолчанию: ${error?.message ?? "не задано"}`);
  return { id: data.id, title: data.title, isTraining: data.is_training };
}

export async function listLocations(): Promise<(LocationInfo & { isDefault: boolean })[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("inv_locations")
    .select("id, title, is_training, is_default")
    .eq("is_active", true)
    .order("is_training");
  if (error) throw new Error(`Места хранения: ${error.message}`);
  return (data ?? []).map((l) => ({ id: l.id, title: l.title, isTraining: l.is_training, isDefault: l.is_default }));
}

// ---------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------

export type GroupOption = { id: string; title: string; kind: GroupKind; isActive: boolean; sort: number };
export type SupplierOption = { id: string; title: string; phone: string | null; notes: string | null; isActive: boolean };
export type ReasonOption = { id: string; title: string; isActive: boolean; sort: number };
export type UnitOption = { code: string; title: string; shortTitle: string };

export async function listGroups(): Promise<GroupOption[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("inv_groups")
    .select("id, title, kind, is_active, sort")
    .order("sort")
    .order("title");
  if (error) throw new Error(`Группы склада: ${error.message}`);
  return (data ?? []).map((g) => ({
    id: g.id,
    title: g.title,
    kind: g.kind as GroupKind,
    isActive: g.is_active,
    sort: g.sort,
  }));
}

export async function listSuppliers(): Promise<SupplierOption[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("inv_suppliers")
    .select("id, title, phone, notes, is_active")
    .order("title");
  if (error) throw new Error(`Поставщики: ${error.message}`);
  return (data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    phone: s.phone,
    notes: s.notes,
    isActive: s.is_active,
  }));
}

export async function listReasons(): Promise<ReasonOption[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("inv_writeoff_reasons")
    .select("id, title, is_active, sort")
    .order("sort")
    .order("title");
  if (error) throw new Error(`Причины списания: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, title: r.title, isActive: r.is_active, sort: r.sort }));
}

export async function listUnits(): Promise<UnitOption[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("inv_units")
    .select("code, title, short_title")
    .order("sort");
  if (error) throw new Error(`Единицы: ${error.message}`);
  return (data ?? []).map((u) => ({ code: u.code, title: u.title, shortTitle: u.short_title }));
}

// ---------------------------------------------------------------
// Остатки
// ---------------------------------------------------------------

export type StockRow = {
  id: string;
  title: string;
  groupId: string | null;
  groupTitle: string | null;
  kind: GroupKind | null;
  unit: string;
  fractional: boolean;
  isTracked: boolean;
  isActive: boolean;
  salePrice: number | null;
  minQty: number | null;
  freshDays: number | null;
  photoUrl: string | null;
  /** Остаток по нашему журналу в текущем месте хранения. */
  qty: number;
  /** Сколько дней лежит самая старая партия (FIFO), по нашему журналу. */
  oldestBatchDays: number | null;
  /** Снимок Posiflora. */
  posifloraQty: number | null;
  posifloraTrainingQty: number | null;
  lastMovementAt: string | null;
  snapshotAt: string | null;
  /** Только для владельцев, иначе null. */
  avgCost: number | null;
  posifloraUnitCost: number | null;
};

const STOCK_SELECT =
  "id, title, group_id, unit_code, fractional, is_tracked, is_active, sale_price, min_qty, fresh_days, avg_cost, photo_url, " +
  "inv_groups(title, kind), inv_units(short_title), inv_stock(qty, location_id), " +
  "inv_posiflora_snapshot(qty, unit_cost, last_movement_at, training_qty, taken_at)";

type StockDbRow = {
  id: string;
  title: string;
  group_id: string | null;
  unit_code: string;
  fractional: boolean;
  is_tracked: boolean;
  is_active: boolean;
  sale_price: number | string | null;
  min_qty: number | string | null;
  fresh_days: number | null;
  avg_cost: number | string | null;
  photo_url: string | null;
  inv_groups: { title: string; kind: string } | { title: string; kind: string }[] | null;
  inv_units: { short_title: string } | { short_title: string }[] | null;
  inv_stock: { qty: number | string; location_id: string }[] | null;
  inv_posiflora_snapshot:
    | { qty: number | string; unit_cost: number | string | null; last_movement_at: string | null; training_qty: number | string; taken_at: string }
    | { qty: number | string; unit_cost: number | string | null; last_movement_at: string | null; training_qty: number | string; taken_at: string }[]
    | null;
};

function mapStockRow(row: StockDbRow, freshness: Map<string, number>, withCosts: boolean, locationId: string): StockRow {
  const group = one(row.inv_groups);
  const unit = one(row.inv_units);
  const snap = one(row.inv_posiflora_snapshot);
  // Только текущее место: тренировочные остатки не должны смешиваться с настоящими.
  const qty = (row.inv_stock ?? [])
    .filter((s) => s.location_id === locationId)
    .reduce((sum, s) => sum + (Number(s.qty) || 0), 0);

  return {
    id: row.id,
    title: row.title,
    groupId: row.group_id,
    groupTitle: group?.title ?? null,
    kind: (group?.kind as GroupKind | undefined) ?? null,
    unit: unit?.short_title ?? "шт",
    fractional: row.fractional,
    isTracked: row.is_tracked,
    isActive: row.is_active,
    salePrice: num(row.sale_price),
    minQty: num(row.min_qty),
    freshDays: row.fresh_days,
    photoUrl: row.photo_url,
    qty,
    oldestBatchDays: freshness.get(row.id) ?? null,
    posifloraQty: snap ? num(snap.qty) : null,
    posifloraTrainingQty: snap ? num(snap.training_qty) : null,
    lastMovementAt: snap?.last_movement_at ?? null,
    snapshotAt: snap?.taken_at ?? null,
    avgCost: withCosts ? num(row.avg_cost) : null,
    posifloraUnitCost: withCosts && snap ? num(snap.unit_cost) : null,
  };
}

async function freshnessMap(locationId: string, itemId?: string): Promise<Map<string, number>> {
  let query = getSupabaseAdmin()
    .from("inv_item_freshness")
    .select("item_id, oldest_batch_days")
    .eq("location_id", locationId);
  if (itemId) query = query.eq("item_id", itemId);
  const { data, error } = await query;
  if (error) throw new Error(`Свежесть: ${error.message}`);
  return new Map((data ?? []).map((f) => [f.item_id as string, Number(f.oldest_batch_days)]));
}

export async function listStock(withCosts: boolean): Promise<StockRow[]> {
  const location = await getDefaultLocation();
  const [{ data, error }, freshness] = await Promise.all([
    getSupabaseAdmin().from("inv_items").select(STOCK_SELECT).order("title").limit(5000),
    freshnessMap(location.id),
  ]);
  if (error) throw new Error(`Остатки: ${error.message}`);
  return ((data ?? []) as unknown as StockDbRow[]).map((row) => mapStockRow(row, freshness, withCosts, location.id));
}

export async function getStockItem(id: string, withCosts: boolean): Promise<StockRow | null> {
  const location = await getDefaultLocation();
  const [{ data, error }, freshness] = await Promise.all([
    getSupabaseAdmin().from("inv_items").select(STOCK_SELECT).eq("id", id).maybeSingle(),
    freshnessMap(location.id, id),
  ]);
  if (error) throw new Error(`Позиция: ${error.message}`);
  if (!data) return null;
  return mapStockRow(data as unknown as StockDbRow, freshness, withCosts, location.id);
}

/** Поля позиции для формы редактирования. */
export type ItemEditable = {
  id: string;
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
  posifloraId: string | null;
};

export async function getItemEditable(id: string): Promise<ItemEditable | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("inv_items")
    .select("id, title, group_id, unit_code, fractional, is_tracked, sale_price, min_qty, fresh_days, barcode, notes, is_active, posiflora_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Позиция: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    groupId: data.group_id,
    unitCode: data.unit_code,
    fractional: data.fractional,
    isTracked: data.is_tracked,
    salePrice: num(data.sale_price),
    minQty: num(data.min_qty),
    freshDays: data.fresh_days,
    barcode: data.barcode,
    notes: data.notes,
    isActive: data.is_active,
    posifloraId: data.posiflora_id,
  };
}

// ---------------------------------------------------------------
// Движения позиции
// ---------------------------------------------------------------

export type MovementRow = {
  documentId: string;
  docNo: string;
  docType: DocType;
  status: DocStatus;
  isReversal: boolean;
  date: string;
  qtyDelta: number | null;
  unitCost: number | null;
  amount: number | null;
  comment: string | null;
  isTraining: boolean;
};

export async function listItemMovements(itemId: string, withCosts: boolean): Promise<MovementRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("inv_document_lines")
    .select("qty_delta, unit_cost, amount, inv_documents!inner(id, doc_no, doc_type, status, doc_date, reversal_of, comment, inv_locations(is_training))")
    .eq("item_id", itemId)
    .neq("inv_documents.status", "draft")
    .limit(300);
  if (error) throw new Error(`Движения: ${error.message}`);

  type Row = {
    qty_delta: number | string | null;
    unit_cost: number | string | null;
    amount: number | string | null;
    inv_documents:
      | MovementDoc
      | MovementDoc[];
  };
  type MovementDoc = {
    id: string;
    doc_no: string;
    doc_type: string;
    status: string;
    doc_date: string;
    reversal_of: string | null;
    comment: string | null;
    inv_locations: { is_training: boolean } | { is_training: boolean }[] | null;
  };

  return ((data ?? []) as unknown as Row[])
    .map((row) => {
      const d = one(row.inv_documents)!;
      return {
        documentId: d.id,
        docNo: d.doc_no,
        docType: d.doc_type as DocType,
        status: d.status as DocStatus,
        isReversal: !!d.reversal_of,
        date: d.doc_date,
        qtyDelta: num(row.qty_delta),
        unitCost: withCosts ? num(row.unit_cost) : null,
        amount: withCosts ? num(row.amount) : null,
        comment: d.comment,
        isTraining: one(d.inv_locations)?.is_training ?? false,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------
// Документы
// ---------------------------------------------------------------

export type DocumentSummary = {
  id: string;
  docNo: string;
  docType: DocType;
  status: DocStatus;
  date: string;
  supplierTitle: string | null;
  reasonTitle: string | null;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
  linesCount: number;
  totalCost: number | null;
  createdBy: string | null;
  isReversal: boolean;
  isTraining: boolean;
};

export async function listDocuments(
  filter: { type?: DocType; status?: DocStatus },
  withCosts: boolean
): Promise<DocumentSummary[]> {
  let query = getSupabaseAdmin()
    .from("inv_documents")
    .select(
      "id, doc_no, doc_type, status, doc_date, payment_method, comment, total_cost, reversal_of, " +
        "inv_suppliers(title), inv_writeoff_reasons(title), staff!inv_documents_created_by_fkey(full_name), inv_document_lines(count), inv_locations(is_training)"
    )
    .order("doc_date", { ascending: false })
    .limit(300);
  if (filter.type) query = query.eq("doc_type", filter.type);
  if (filter.status) query = query.eq("status", filter.status);

  const { data, error } = await query;
  if (error) throw new Error(`Документы: ${error.message}`);

  type Row = {
    id: string;
    doc_no: string;
    doc_type: string;
    status: string;
    doc_date: string;
    payment_method: string | null;
    comment: string | null;
    total_cost: number | string;
    reversal_of: string | null;
    inv_suppliers: { title: string } | { title: string }[] | null;
    inv_writeoff_reasons: { title: string } | { title: string }[] | null;
    staff: { full_name: string } | { full_name: string }[] | null;
    inv_document_lines: { count: number }[] | null;
    inv_locations: { is_training: boolean } | { is_training: boolean }[] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((d) => ({
    id: d.id,
    docNo: d.doc_no,
    docType: d.doc_type as DocType,
    status: d.status as DocStatus,
    date: d.doc_date,
    supplierTitle: one(d.inv_suppliers)?.title ?? null,
    reasonTitle: one(d.inv_writeoff_reasons)?.title ?? null,
    paymentMethod: (d.payment_method as PaymentMethod | null) ?? null,
    comment: d.comment,
    linesCount: d.inv_document_lines?.[0]?.count ?? 0,
    totalCost: withCosts ? num(d.total_cost) : null,
    createdBy: one(d.staff)?.full_name ?? null,
    isReversal: !!d.reversal_of,
    isTraining: one(d.inv_locations)?.is_training ?? false,
  }));
}

export type DocumentLineDetail = {
  itemId: string;
  itemTitle: string;
  unit: string;
  qty: number;
  qtyDelta: number | null;
  stockBefore: number | null;
  /** Цена закупки в приходе видна всем, кто его вводит; прочие цены — только владельцам. */
  unitCost: number | null;
  amount: number | null;
};

export type DocumentDetail = {
  id: string;
  docNo: string;
  docType: DocType;
  status: DocStatus;
  date: string;
  supplierId: string | null;
  supplierTitle: string | null;
  reasonId: string | null;
  reasonTitle: string | null;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
  totalCost: number | null;
  reversalOf: { id: string; docNo: string } | null;
  reversedBy: { id: string; docNo: string } | null;
  createdBy: string | null;
  postedBy: string | null;
  postedAt: string | null;
  lines: DocumentLineDetail[];
};

export async function getDocument(id: string, withCosts: boolean): Promise<DocumentDetail | null> {
  const admin = getSupabaseAdmin();
  const { data: d, error } = await admin
    .from("inv_documents")
    .select(
      "id, doc_no, doc_type, status, doc_date, supplier_id, writeoff_reason_id, payment_method, comment, total_cost, reversal_of, posted_at, " +
        "inv_suppliers(title), inv_writeoff_reasons(title), " +
        "creator:staff!inv_documents_created_by_fkey(full_name), poster:staff!inv_documents_posted_by_fkey(full_name)"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Документ: ${error.message}`);
  if (!d) return null;

  type Doc = {
    id: string;
    doc_no: string;
    doc_type: string;
    status: string;
    doc_date: string;
    supplier_id: string | null;
    writeoff_reason_id: string | null;
    payment_method: string | null;
    comment: string | null;
    total_cost: number | string;
    reversal_of: string | null;
    posted_at: string | null;
    inv_suppliers: { title: string } | { title: string }[] | null;
    inv_writeoff_reasons: { title: string } | { title: string }[] | null;
    creator: { full_name: string } | { full_name: string }[] | null;
    poster: { full_name: string } | { full_name: string }[] | null;
  };
  const doc = d as unknown as Doc;

  const [{ data: lines, error: linesError }, { data: original }, { data: reversal }] = await Promise.all([
    admin
      .from("inv_document_lines")
      .select("item_id, qty, qty_delta, stock_before, unit_cost, amount, sort, inv_items(title, inv_units(short_title))")
      .eq("document_id", id)
      .order("sort"),
    doc.reversal_of
      ? admin.from("inv_documents").select("id, doc_no").eq("id", doc.reversal_of).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("inv_documents").select("id, doc_no").eq("reversal_of", id).maybeSingle(),
  ]);
  if (linesError) throw new Error(`Строки документа: ${linesError.message}`);

  type Line = {
    item_id: string;
    qty: number | string;
    qty_delta: number | string | null;
    stock_before: number | string | null;
    unit_cost: number | string | null;
    amount: number | string | null;
    inv_items:
      | { title: string; inv_units: { short_title: string } | { short_title: string }[] | null }
      | { title: string; inv_units: { short_title: string } | { short_title: string }[] | null }[]
      | null;
  };

  // Цену закупки в приходе вводит сам человек — её можно показывать всем,
  // кто видит документ. Средняя, заморожённая в списании или инвентаризации,
  // — это уже себестоимость, и её видят только владельцы.
  const showLineCost = withCosts || doc.doc_type === "receipt";

  return {
    id: doc.id,
    docNo: doc.doc_no,
    docType: doc.doc_type as DocType,
    status: doc.status as DocStatus,
    date: doc.doc_date,
    supplierId: doc.supplier_id,
    supplierTitle: one(doc.inv_suppliers)?.title ?? null,
    reasonId: doc.writeoff_reason_id,
    reasonTitle: one(doc.inv_writeoff_reasons)?.title ?? null,
    paymentMethod: (doc.payment_method as PaymentMethod | null) ?? null,
    comment: doc.comment,
    totalCost: withCosts || doc.doc_type === "receipt" ? num(doc.total_cost) : null,
    reversalOf: original ? { id: original.id, docNo: original.doc_no } : null,
    reversedBy: reversal ? { id: reversal.id, docNo: reversal.doc_no } : null,
    createdBy: one(doc.creator)?.full_name ?? null,
    postedBy: one(doc.poster)?.full_name ?? null,
    postedAt: doc.posted_at,
    lines: ((lines ?? []) as unknown as Line[]).map((l) => {
      const item = one(l.inv_items);
      return {
        itemId: l.item_id,
        itemTitle: item?.title ?? "—",
        unit: one(item?.inv_units)?.short_title ?? "шт",
        qty: Number(l.qty),
        qtyDelta: num(l.qty_delta),
        stockBefore: num(l.stock_before),
        unitCost: showLineCost ? num(l.unit_cost) : null,
        amount: showLineCost ? num(l.amount) : null,
      };
    }),
  };
}

/** Позиции для выбора в документе: коротко, без себестоимости. */
export type PickerItem = {
  id: string;
  title: string;
  groupTitle: string | null;
  unit: string;
  fractional: boolean;
  qty: number;
  posifloraQty: number | null;
  isActive: boolean;
};

export async function listPickerItems(): Promise<PickerItem[]> {
  const rows = await listStock(false);
  return rows
    .filter((r) => r.isTracked)
    .map((r) => ({
      id: r.id,
      title: r.title,
      groupTitle: r.groupTitle,
      unit: r.unit,
      fractional: r.fractional,
      qty: r.qty,
      posifloraQty: r.posifloraQty,
      isActive: r.isActive,
    }));
}
