import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Чтение торгового зала: смена, наличные, витрина, справочники кассы.
//
// Как и на складе, себестоимость отдаётся только тем, кому её видно
// (withCosts) — сервер просто не кладёт её в данные страницы.
// ================================================================

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ---------------------------------------------------------------
// Смена
// ---------------------------------------------------------------

export type OpenShift = {
  id: string;
  openedAt: string;
  openedBy: string | null;
  openingCash: number;
  previousCounted: number | null;
  expectedCash: number;
};

export async function getOpenShift(locationId: string): Promise<OpenShift | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("pos_shifts")
    .select("id, opened_at, opening_cash, previous_counted_cash, hr_employees!pos_shifts_opened_by_fkey(short_name)")
    .eq("location_id", locationId)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw new Error(`Смена: ${error.message}`);
  if (!data) return null;

  const { data: expected, error: e2 } = await admin.rpc("pos_shift_expected_cash", { p_shift: data.id });
  if (e2) throw new Error(`Наличные в кассе: ${e2.message}`);

  const opener = one(data.hr_employees as { short_name: string } | { short_name: string }[] | null);
  return {
    id: data.id,
    openedAt: data.opened_at,
    openedBy: opener?.short_name ?? null,
    openingCash: num(data.opening_cash),
    previousCounted: data.previous_counted_cash === null ? null : num(data.previous_counted_cash),
    expectedCash: num(expected),
  };
}

/** Последняя закрытая смена — чтобы при открытии предложить её пересчёт. */
export async function getLastClosedShift(locationId: string): Promise<{ closedAt: string; counted: number; expected: number } | null> {
  const { data } = await getSupabaseAdmin()
    .from("pos_shifts")
    .select("closed_at, counted_cash, expected_cash")
    .eq("location_id", locationId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { closedAt: data.closed_at, counted: num(data.counted_cash), expected: num(data.expected_cash) };
}

export type CashLine = {
  id: string;
  at: string;
  kind: "sale" | "in" | "out" | "open";
  title: string;
  note: string | null;
  amount: number;
  who: string | null;
  receiptDocId: string | null;
};

/** Всё, что двигало наличные в смене, — от новых к старым. */
export async function listShiftCash(shift: OpenShift): Promise<CashLine[]> {
  const admin = getSupabaseAdmin();
  const [moves, sales] = await Promise.all([
    admin
      .from("pos_cash_movements")
      .select(
        "id, created_at, direction, amount, comment, receipt_doc_id, pos_cash_reasons(title), " +
          "who:hr_employees!pos_cash_movements_employee_id_fkey(short_name), paid:hr_employees!pos_cash_movements_paid_employee_id_fkey(short_name)"
      )
      .eq("shift_id", shift.id)
      .order("created_at", { ascending: false }),
    admin
      .from("pos_sales")
      .select("id, sale_no, created_at, total, hr_employees!pos_sales_employee_id_fkey(short_name), pos_payments(method, amount, pos_payment_methods(is_cash))")
      .eq("shift_id", shift.id)
      .eq("status", "paid")
      .order("created_at", { ascending: false }),
  ]);
  if (moves.error) throw new Error(`Движения наличных: ${moves.error.message}`);
  if (sales.error) throw new Error(`Продажи смены: ${sales.error.message}`);

  type MoveRow = {
    id: string;
    created_at: string;
    direction: "in" | "out";
    amount: number | string;
    comment: string | null;
    receipt_doc_id: string | null;
    pos_cash_reasons: { title: string } | { title: string }[] | null;
    who: { short_name: string } | { short_name: string }[] | null;
    paid: { short_name: string } | { short_name: string }[] | null;
  };
  type SaleRow = {
    id: string;
    sale_no: string;
    created_at: string;
    total: number | string;
    hr_employees: { short_name: string } | { short_name: string }[] | null;
    pos_payments: { method: string; amount: number | string; pos_payment_methods: { is_cash: boolean } | { is_cash: boolean }[] | null }[];
  };

  const lines: CashLine[] = [];
  for (const m of (moves.data ?? []) as unknown as MoveRow[]) {
    const paid = one(m.paid)?.short_name;
    lines.push({
      id: m.id,
      at: m.created_at,
      kind: m.direction,
      title: `${m.direction === "in" ? "Внесение" : "Изъятие"} · ${one(m.pos_cash_reasons)?.title ?? ""}${paid ? ` · ${paid}` : ""}`,
      note: m.comment,
      amount: m.direction === "in" ? num(m.amount) : -num(m.amount),
      who: one(m.who)?.short_name ?? null,
      receiptDocId: m.receipt_doc_id,
    });
  }
  for (const s of (sales.data ?? []) as unknown as SaleRow[]) {
    const cash = s.pos_payments.filter((p) => one(p.pos_payment_methods)?.is_cash).reduce((sum, p) => sum + num(p.amount), 0);
    if (cash <= 0) continue;
    lines.push({
      id: s.id,
      at: s.created_at,
      kind: "sale",
      title: `Продажа ${s.sale_no}`,
      note: cash < num(s.total) ? `из ${num(s.total).toLocaleString("ru-RU")} ₽ — остальное не наличными` : null,
      amount: cash,
      who: one(s.hr_employees)?.short_name ?? null,
      receiptDocId: null,
    });
  }
  lines.sort((a, b) => b.at.localeCompare(a.at));
  lines.push({ id: "open", at: shift.openedAt, kind: "open", title: "Открытие смены", note: null, amount: shift.openingCash, who: shift.openedBy, receiptDocId: null });
  return lines;
}

/** Итоги смены по способам оплаты — для экрана смены и закрытия. */
export async function getShiftTotals(shiftId: string): Promise<{ count: number; total: number; byMethod: { title: string; amount: number }[] }> {
  const { data, error } = await getSupabaseAdmin()
    .from("pos_sales")
    .select("total, pos_payments(amount, pos_payment_methods(title, sort))")
    .eq("shift_id", shiftId)
    .eq("status", "paid");
  if (error) throw new Error(`Итоги смены: ${error.message}`);

  type Row = { total: number | string; pos_payments: { amount: number | string; pos_payment_methods: { title: string; sort: number } | { title: string; sort: number }[] | null }[] };
  const by = new Map<string, { amount: number; sort: number }>();
  let total = 0;
  for (const s of (data ?? []) as unknown as Row[]) {
    total += num(s.total);
    for (const p of s.pos_payments) {
      const m = one(p.pos_payment_methods);
      const key = m?.title ?? "Другое";
      const cur = by.get(key) ?? { amount: 0, sort: m?.sort ?? 99 };
      cur.amount += num(p.amount);
      by.set(key, cur);
    }
  }
  return {
    count: (data ?? []).length,
    total,
    byMethod: [...by.entries()].sort((a, b) => a[1].sort - b[1].sort).map(([title, v]) => ({ title, amount: v.amount })),
  };
}

// ---------------------------------------------------------------
// Справочники кассы
// ---------------------------------------------------------------

export type PaymentMethodOption = { code: string; title: string; isCash: boolean };
export type CashReasonOption = { id: string; direction: "in" | "out"; title: string; kind: "purchase" | "salary" | "collection" | "other" };
export type PosSettings = { discountLimitPercent: number; compositionRequired: boolean; bonusesEnabled: boolean; bonusPercent: number };

export async function listPaymentMethods(): Promise<PaymentMethodOption[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("pos_payment_methods")
    .select("code, title, is_cash")
    .eq("is_active", true)
    .order("sort");
  if (error) throw new Error(`Способы оплаты: ${error.message}`);
  return (data ?? []).map((m) => ({ code: m.code, title: m.title, isCash: m.is_cash }));
}

export async function listCashReasons(): Promise<CashReasonOption[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("pos_cash_reasons")
    .select("id, direction, title, kind")
    .eq("is_active", true)
    .order("sort");
  if (error) throw new Error(`Причины движения наличных: ${error.message}`);
  return (data ?? []) as CashReasonOption[];
}

export async function getPosSettings(): Promise<PosSettings> {
  const { data, error } = await getSupabaseAdmin()
    .from("pos_settings")
    .select("discount_limit_percent, composition_required, bonuses_enabled, bonus_percent")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) throw new Error(`Настройки кассы: ${error?.message ?? "нет строки"}`);
  return {
    discountLimitPercent: num(data.discount_limit_percent),
    compositionRequired: data.composition_required,
    bonusesEnabled: data.bonuses_enabled,
    bonusPercent: num(data.bonus_percent),
  };
}

// ---------------------------------------------------------------
// Витрина
// ---------------------------------------------------------------

export type VitrineBouquet = {
  id: string;
  title: string;
  price: number;
  photoUrls: string[];
  assembledAt: string;
  assembledBy: string | null;
  /** Сколько календарных дней назад собран (по Симферополю): 0 — сегодня, 1 — вчера. */
  days: number;
  composition: { itemId: string; title: string; qty: number }[];
  /** Только владельцам. */
  cost: number | null;
};

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Simferopol" });

/** Полночь календарного дня по Симферополю — для «какой день на витрине». */
function simferopolDay(d: Date): number {
  return new Date(`${dayFmt.format(d)}T00:00:00Z`).getTime();
}

export async function listVitrine(locationId: string, withCosts: boolean): Promise<VitrineBouquet[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("pos_bouquets")
    .select(
      "id, title, price, photo_urls, assembled_at, cost, hr_employees!pos_bouquets_assembled_by_fkey(short_name), " +
        "pos_bouquet_items(item_id, qty, inv_items(title))"
    )
    .eq("location_id", locationId)
    .eq("status", "vitrine")
    .order("assembled_at");
  if (error) throw new Error(`Витрина: ${error.message}`);

  type Row = {
    id: string;
    title: string;
    price: number | string;
    photo_urls: string[] | null;
    assembled_at: string;
    cost: number | string | null;
    hr_employees: { short_name: string } | { short_name: string }[] | null;
    pos_bouquet_items: { item_id: string; qty: number | string; inv_items: { title: string } | { title: string }[] | null }[];
  };

  const today = simferopolDay(new Date());
  return ((data ?? []) as unknown as Row[]).map((b) => ({
    id: b.id,
    title: b.title,
    price: num(b.price),
    photoUrls: b.photo_urls ?? [],
    assembledAt: b.assembled_at,
    assembledBy: one(b.hr_employees)?.short_name ?? null,
    days: Math.round((today - simferopolDay(new Date(b.assembled_at))) / 86_400_000),
    composition: b.pos_bouquet_items.map((i) => ({ itemId: i.item_id, title: one(i.inv_items)?.title ?? "—", qty: num(i.qty) })),
    cost: withCosts && b.cost !== null ? num(b.cost) : null,
  }));
}

// ---------------------------------------------------------------
// Ассортимент кассы
// ---------------------------------------------------------------

export type KassaItem = {
  id: string;
  title: string;
  groupId: string | null;
  price: number | null;
  /** Остаток для показа: в тренировке — по Posiflora, как и на складе. */
  qty: number;
  minQty: number | null;
  isTracked: boolean;
  /** Отдельной строкой в чеке, а не в букет: игрушки, шары, открытки, услуги. */
  standalone: boolean;
  oldestDays: number | null;
  freshDays: number | null;
};

export type KassaGroup = { id: string; title: string; icon: string | null; kind: string };

const STANDALONE_KINDS = new Set(["gift", "print", "service", "bouquet"]);

export async function listKassaAssortment(
  locationId: string,
  isTraining: boolean
): Promise<{ items: KassaItem[]; groups: KassaGroup[]; frequent: string[] }> {
  const admin = getSupabaseAdmin();
  const [items, groups, fresh, freq] = await Promise.all([
    admin
      .from("inv_items")
      .select("id, title, group_id, sale_price, min_qty, is_tracked, fresh_days, inv_groups(kind), inv_stock(qty, location_id), inv_posiflora_snapshot(qty, movements)")
      .eq("is_active", true)
      .order("title")
      .limit(2000),
    admin.from("inv_groups").select("id, title, icon, kind, sort").eq("is_active", true).order("sort").order("title"),
    admin.from("inv_item_freshness").select("item_id, oldest_batch_days").eq("location_id", locationId),
    // Частые — по продажам за 30 дней в этом месте.
    admin
      .from("inv_document_lines")
      .select("item_id, qty, inv_documents!inner(doc_type, location_id, status, doc_date)")
      .eq("inv_documents.doc_type", "sale")
      .eq("inv_documents.location_id", locationId)
      .eq("inv_documents.status", "posted")
      .gte("inv_documents.doc_date", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .limit(5000),
  ]);
  if (items.error) throw new Error(`Ассортимент: ${items.error.message}`);
  if (groups.error) throw new Error(`Группы: ${groups.error.message}`);

  const freshMap = new Map((fresh.data ?? []).map((f) => [f.item_id as string, f.oldest_batch_days as number]));

  type ItemRow = {
    id: string;
    title: string;
    group_id: string | null;
    sale_price: number | string | null;
    min_qty: number | string | null;
    is_tracked: boolean;
    fresh_days: number | null;
    inv_groups: { kind: string } | { kind: string }[] | null;
    inv_stock: { qty: number | string; location_id: string }[] | null;
    inv_posiflora_snapshot: { qty: number | string; movements: number | null } | { qty: number | string; movements: number | null }[] | null;
  };

  const movements = new Map<string, number>();

  const list: KassaItem[] = ((items.data ?? []) as unknown as ItemRow[]).map((r) => {
    const own = (r.inv_stock ?? []).filter((s) => s.location_id === locationId).reduce((s, x) => s + num(x.qty), 0);
    const snap = one(r.inv_posiflora_snapshot);
    const kind = one(r.inv_groups)?.kind ?? "other";
    if (snap?.movements) movements.set(r.id, snap.movements);
    return {
      id: r.id,
      title: r.title,
      groupId: r.group_id,
      price: r.sale_price === null ? null : num(r.sale_price),
      qty: isTraining && snap ? num(snap.qty) : own,
      minQty: r.min_qty === null ? null : num(r.min_qty),
      isTracked: r.is_tracked,
      standalone: STANDALONE_KINDS.has(kind) || !r.is_tracked,
      oldestDays: freshMap.get(r.id) ?? null,
      freshDays: r.fresh_days,
    };
  });

  const counts = new Map<string, number>();
  for (const l of (freq.data ?? []) as { item_id: string; qty: number | string }[]) {
    counts.set(l.item_id, (counts.get(l.item_id) ?? 0) + num(l.qty));
  }
  const frequent = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id);

  // Пока своих продаж мало, дополняем самыми ходовыми по Posiflora — иначе
  // в первые дни «Частые» пустовали бы, хотя что ходовое, известно.
  if (frequent.length < 12) {
    const fill = [...movements.entries()]
      .filter(([id]) => !counts.has(id) && list.some((i) => i.id === id && !i.standalone))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    frequent.push(...fill.slice(0, 12 - frequent.length));
  }

  return {
    items: list,
    groups: (groups.data ?? []).map((g) => ({ id: g.id, title: g.title, icon: g.icon, kind: g.kind })),
    frequent,
  };
}

// ---------------------------------------------------------------
// Клиенты
// ---------------------------------------------------------------

export type CustomerHit = {
  id: string;
  name: string | null;
  phone: string;
  bonusBalance: number;
  lastOrderAt: string | null;
};
