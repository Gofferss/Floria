"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { BonusMoveRow, CustomerRow, PosifloraCustomer, Purchase } from "@/lib/uchet/customers";
import { adjustBonus, importPosifloraCustomers, loadCustomerHistory, updateCustomer } from "@/lib/uchet/customer-actions";
import { formatDate, formatMoney } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { CloseButton, Panel } from "@/components/uchet/Overlay";

const KIND: Record<Purchase["kind"], string> = { site: "Сайт", shop: "Магазин", shop_order: "Заказ магазина" };

/** «+7 (978) 123-45-67» из «+79781234567». */
function prettyPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length === 11 ? `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}` : p;
}

/**
 * Клиенты: одна база на сайт и магазин. Видно, кто сколько раз покупал,
 * на сколько и когда последний раз; в карточке — история и заметка.
 */
export function CustomersView({
  customers,
  query,
  posiflora,
  posifloraError,
  bonusesEnabled,
}: {
  customers: CustomerRow[];
  query: string;
  posiflora: PosifloraCustomer[];
  posifloraError: string | null;
  bonusesEnabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(query);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = customers.find((c) => c.id === openId) ?? null;

  useEffect(() => {
    if (q === query) return;
    const id = setTimeout(() => router.replace(q.trim() ? `${pathname}?q=${encodeURIComponent(q.trim())}` : pathname), 350);
    return () => clearTimeout(id);
  }, [q, query, pathname, router]);

  const buyers = customers.filter((c) => c.purchases > 0).length;

  return (
    <div className={`${ui.page} max-w-5xl space-y-5`}>
      <section className={ui.cardPad}>
        <h1 className={ui.h1}>Клиенты</h1>
        <p className={`${ui.muted} mt-1 max-w-2xl`}>
          Одна база на сайт и магазин. С сайта клиенты приходят сами, в магазине — когда флорист вбивает телефон в кассе: так копится история
          покупок, а потом и бонусы.
        </p>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Телефон или имя"
          aria-label="Поиск клиента"
          className={`${ui.field} mt-4`}
        />
        <p className="mt-2 text-sm text-zinc-500">
          {query ? `Нашлось: ${customers.length}` : `Всего: ${customers.length}`} · покупали: {buyers}
        </p>
      </section>

      {posiflora.length > 0 && <PosifloraImport list={posiflora} />}
      {posifloraError && <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600">Клиентов Posiflora сверить не удалось: {posifloraError.slice(0, 160)}</p>}

      <section className={ui.card}>
        {customers.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">{query ? "Никого не нашли." : "Пока никого."}</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {customers.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-left hover:bg-zinc-50">
                  <span className="min-w-[180px] flex-1">
                    <span className="block font-semibold text-zinc-900">{c.name || "Без имени"}</span>
                    <span className="block text-sm tabular-nums text-zinc-500">
                      {prettyPhone(c.phone)}
                      {c.hasAccount && " · есть вход на сайт"}
                    </span>
                  </span>
                  <span className="flex gap-5 text-right text-sm tabular-nums">
                    <Cell value={String(c.purchases)} label="покупок" />
                    <Cell value={formatMoney(Math.round(c.spent))} label="на сумму" />
                    <Cell value={c.lastAt ? formatDate(c.lastAt) : "—"} label="последняя" />
                    <Cell value={formatMoney(c.bonusBalance)} label="бонусы" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && <CustomerCard c={open} bonusesEnabled={bonusesEnabled} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Cell({ value, label }: { value: string; label: string }) {
  return (
    <span className="block min-w-[64px]">
      <span className="block whitespace-nowrap text-zinc-800">{value}</span>
      <span className="block text-xs text-zinc-400">{label}</span>
    </span>
  );
}

function PosifloraImport({ list }: { list: PosifloraCustomer[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const withPhone = list.filter((c) => c.phone);

  async function run() {
    setBusy(true);
    const result = await importPosifloraCustomers(withPhone.map((c) => c.id)).catch(() => ({ success: false as const, error: "Не получилось — обновите страницу" }));
    setBusy(false);
    if (!result.success) return toast({ tone: "error", text: result.error });
    toast({ tone: "ok", text: `Перенесено: ${result.data.added}` });
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
      <p className="font-semibold text-zinc-900">В Posiflora есть клиенты, которых нет здесь: {list.length}</p>
      <p className="mt-1 text-sm text-zinc-700">
        Перенесутся имя, телефон, день рождения и баланс бонусов. В Posiflora ничего не изменится. {withPhone.length < list.length && `Без телефона — ${list.length - withPhone.length}, их не переносим.`}
      </p>
      <ul className="mt-2 text-sm text-zinc-700">
        {list.slice(0, 8).map((c) => (
          <li key={c.id}>
            {c.name}
            {c.ordersQty > 0 && <span className="text-zinc-500"> · заказов {c.ordersQty}</span>}
            {c.points > 0 && <span className="text-zinc-500"> · бонусов {c.points}</span>}
          </li>
        ))}
        {list.length > 8 && <li className="text-zinc-500">и ещё {list.length - 8}</li>}
      </ul>
      {withPhone.length > 0 && (
        <button type="button" disabled={busy} onClick={run} className={`${ui.btnPrimary} mt-3`}>
          {busy ? "…" : `Перенести (${withPhone.length})`}
        </button>
      )}
    </section>
  );
}

function CustomerCard({ c, bonusesEnabled, onClose }: { c: CustomerRow; bonusesEnabled: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(c.name ?? "");
  const [birthday, setBirthday] = useState(c.birthday ?? "");
  const [notes, setNotes] = useState(c.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Purchase[] | null>(null);
  const [bonuses, setBonuses] = useState<BonusMoveRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const dirty = name !== (c.name ?? "") || birthday !== (c.birthday ?? "") || notes !== (c.notes ?? "");

  useEffect(() => {
    let cancelled = false;
    loadCustomerHistory(c.id)
      .then((r) => {
        if (cancelled) return;
        if (r.success) {
          setHistory(r.data.purchases);
          setBonuses(r.data.bonuses);
        }
        else setHistoryError(`Не загрузилось: ${r.error}`);
      })
      .catch(() => !cancelled && setHistoryError("Не загрузилось — обновите страницу"));
    return () => {
      cancelled = true;
    };
  }, [c.id]);

  async function save() {
    setBusy(true);
    const result = await updateCustomer(c.id, { name, birthday: birthday || null, notes }).catch(() => ({ success: false as const, error: "Не получилось — обновите страницу" }));
    setBusy(false);
    if (!result.success) return toast({ tone: "error", text: result.error });
    toast({ tone: "ok", text: "Сохранено" });
    router.refresh();
  }

  return (
    <Panel label={`Клиент: ${c.name ?? c.phone}`} onClose={onClose}>
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-100 bg-white px-5 py-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-zinc-900">{c.name || "Без имени"}</h2>
          <a href={`tel:${c.phone}`} className="text-sm font-semibold tabular-nums text-lavender-700 underline underline-offset-2">
            {prettyPhone(c.phone)}
          </a>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      <div className="space-y-6 px-5 py-5">
        <section className="grid grid-cols-3 gap-2 text-center">
          <Stat label="покупок" value={String(c.purchases)} />
          <Stat label="на сумму" value={formatMoney(Math.round(c.spent))} />
          <Stat label="бонусы" value={formatMoney(c.bonusBalance)} />
        </section>
        <p className="-mt-4 text-xs text-zinc-500">
          {c.hasAccount ? "Есть вход на сайт" : "Входа на сайт нет"} · {c.inPosiflora ? "связан с Posiflora — бонусы оттуда" : "в Posiflora не связан"} · в базе с{" "}
          {formatDate(c.createdAt)}
        </p>

        <section className="space-y-3">
          <h3 className={ui.label}>Карточка</h3>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-zinc-600">Имя</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={ui.fieldSm} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-zinc-600">День рождения</span>
            <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className={ui.fieldInline} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-zinc-600">Заметка</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} placeholder="Любит пионы, не любит лилии…" className={ui.fieldSm} />
          </label>
          {c.email && <p className="text-sm text-zinc-600">Почта: {c.email}</p>}
          {dirty && (
            <button type="button" disabled={busy} onClick={save} className={ui.btnPrimary}>
              {busy ? "…" : "Сохранить"}
            </button>
          )}
        </section>

        <section>
          <h3 className={ui.label}>Покупки</h3>
          {historyError ? (
            <p className="mt-2 text-sm text-red-700">{historyError}</p>
          ) : history === null ? (
            <p className="mt-2 text-sm text-zinc-500">Загружаем…</p>
          ) : history.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Пока ни одной.</p>
          ) : (
            <ul className="mt-2 divide-y divide-zinc-100 text-sm">
              {history.map((p) => (
                <li key={`${p.kind}${p.number}`} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 text-zinc-800">
                    {formatDate(p.at)} · {KIND[p.kind]} <span className="text-zinc-500">{p.number}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-900">{p.kind === "shop_order" ? <span className="text-zinc-500">в чеках</span> : formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <BonusSection customerId={c.id} enabled={bonusesEnabled} moves={bonuses} />
      </div>
    </Panel>
  );
}

const MOVE_LABEL: Record<string, string> = {
  earn: "начислено",
  spend: "оплачено бонусами",
  reverse: "снято при отмене",
  return: "возвращено при отмене",
  manual: "вручную",
  import: "перенос из Posiflora",
};

/** История бонусов и ручная правка — только когда бонусы ведёт Учёт. */
function BonusSection({ customerId, enabled, moves }: { customerId: string; enabled: boolean; moves: BonusMoveRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await adjustBonus(customerId, sign * Number(amount.replace(/\s/g, "")), comment).catch(() => ({ success: false as const, error: "Не получилось — обновите страницу" }));
    setBusy(false);
    if (!result.success) return toast({ tone: "error", text: result.error });
    toast({ tone: "ok", text: "Бонусы поправлены" });
    setAmount("");
    setComment("");
    router.refresh();
  }

  if (!enabled) {
    return (
      <section>
        <h3 className={ui.label}>Бонусы</h3>
        <p className="mt-2 text-sm text-zinc-500">Пока бонусы ведёт Posiflora — история и правка там. Переход — в «Настройках».</p>
      </section>
    );
  }
  return (
    <section>
      <h3 className={ui.label}>Бонусы</h3>
      {moves.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">Движений пока нет.</p>
      ) : (
        <ul className="mt-2 divide-y divide-zinc-100 text-sm">
          {moves.map((m, i) => (
            <li key={`${m.at}${i}`} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 text-zinc-800">
                {formatDate(m.at)} · {MOVE_LABEL[m.kind] ?? m.kind}
                {m.comment && <span className="text-zinc-500"> · {m.comment}</span>}
              </span>
              <span className={`shrink-0 tabular-nums ${m.delta > 0 ? "text-emerald-700" : "text-zinc-900"}`}>
                {m.delta > 0 ? "+" : "−"}
                {Math.abs(m.delta).toLocaleString("ru-RU")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="flex overflow-hidden rounded-lg ring-1 ring-zinc-300">
          <button type="button" onClick={() => setSign(1)} className={`px-3 text-sm font-semibold ${sign > 0 ? "bg-zinc-900 text-white" : "bg-white text-zinc-700"}`}>
            Начислить
          </button>
          <button type="button" onClick={() => setSign(-1)} className={`px-3 text-sm font-semibold ${sign < 0 ? "bg-zinc-900 text-white" : "bg-white text-zinc-700"}`}>
            Списать
          </button>
        </div>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="сколько" className={`${ui.fieldInline} w-24`} />
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="за что" className={`${ui.fieldInline} min-w-[120px] flex-1`} />
        <button type="button" disabled={busy || !amount || !comment.trim()} onClick={save} className={`${ui.btnSecondary} min-h-[38px] px-4`}>
          {busy ? "…" : "Готово"}
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-2 py-3">
      <p className="whitespace-nowrap font-display text-base font-semibold tabular-nums text-zinc-900">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}
