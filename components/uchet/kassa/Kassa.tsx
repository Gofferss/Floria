"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { assembleBouquet, recordSale } from "@/lib/uchet/pos-actions";
import type { KassaGroup, KassaItem, PaymentMethodOption, PosSettings, VitrineBouquet } from "@/lib/uchet/pos-queries";
import type { PickableEmployee } from "@/lib/uchet/people";
import { formatMoney } from "@/lib/uchet/format";
import { useToast } from "@/components/uchet/Toast";
import { Assortment } from "@/components/uchet/kassa/Assortment";
import { CheckPanel } from "@/components/uchet/kassa/CheckPanel";
import { PaySheet } from "@/components/uchet/kassa/PaySheet";
import { AmountDialog, CustomerPanel, DiscountDialog, DoneSheet, ToVitrineDialog, VitrinePicker } from "@/components/uchet/kassa/KassaDialogs";
import {
  bouquetPrice,
  due,
  isEmpty,
  loadSaved,
  newCheck,
  save,
  toSaleInput,
  vitrineLine,
  type BouquetLine,
  type Check,
} from "@/components/uchet/kassa/check";

type Props = {
  mode: "sale" | "assembly";
  /** Пришли с витрины кнопкой «Продать» — этот букет сразу в чек. */
  addVitrineId: string | null;
  /** Сборка к заказу магазина, а не на витрину. */
  forOrder: { id: string; number: string; wishes: string | null } | null;
  shiftOpen: boolean;
  items: KassaItem[];
  groups: KassaGroup[];
  frequent: string[];
  vitrine: VitrineBouquet[];
  methods: PaymentMethodOption[];
  settings: PosSettings;
  approvers: PickableEmployee[];
};

type Dialog =
  | null
  | { kind: "pay" }
  | { kind: "price"; bouquetKey: string }
  | { kind: "itemPrice"; itemId: string }
  | { kind: "priceBouquet" }
  | { kind: "discount" }
  | { kind: "customer" }
  | { kind: "vitrine" }
  | { kind: "toVitrine" }
  | { kind: "done"; text: string; note: string | null };

function newBouquet(n: number): BouquetLine {
  return { key: crypto.randomUUID(), title: `Букет ${n}`, manualPrice: null, stems: [] };
}

/**
 * Касса. Слева — что положить в чек, справа — чек. Самые частые дела —
 * в четыре касания: витрина → букет → оплата → способ.
 *
 * Режим «сборка на витрину» — та же касса, но вместо оплаты кнопка «На
 * витрину»: цветы списываются при сборке, на витрине появляется букет.
 */
export function Kassa({ mode, addVitrineId, forOrder, shiftOpen, items, groups, frequent, vitrine, methods, settings, approvers }: Props) {
  const router = useRouter();
  const toast = useToast();
  const assembly = mode === "assembly";

  const index = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [check, setCheck] = useState<Check>(() => newCheck());
  const [parked, setParked] = useState<Check[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  // Чек продажи переживает перезагрузку и закрытие приложения. Сборка —
  // нет: она короткая и всегда начинается с чистого листа.
  useEffect(() => {
    if (assembly) {
      const b = newBouquet(1);
      b.title = forOrder ? `Букет к заказу ${forOrder.number}` : "Букет на витрину";
      setCheck({ ...newCheck(), bouquets: [b] });
      setActiveKey(b.key);
      restored.current = true;
      return;
    }
    const saved = loadSaved();
    let current = saved?.current ?? newCheck();
    // Букеты витрины, которых уже нет на витрине (продал другой планшет),
    // из чека убираем — и говорим об этом.
    const onVitrine = new Set(vitrine.map((v) => v.id));
    const gone = current.vitrine.filter((v) => !onVitrine.has(v.bouquetId));
    if (gone.length) {
      current = { ...current, vitrine: current.vitrine.filter((v) => onVitrine.has(v.bouquetId)) };
      toast({ tone: "error", text: `«${gone[0].title}» уже не на витрине — убран из чека` });
    }
    // Позиции, которых в кассе больше нет (скрыли на складе), тоже убираем:
    // иначе в чеке висела бы строка «—», которую не продать.
    const known = (id: string) => index.has(id);
    const lost =
      current.items.filter((l) => !known(l.itemId)).length +
      current.bouquets.reduce((n, b) => n + b.stems.filter((s) => !known(s.itemId)).length, 0);
    if (lost) {
      current = {
        ...current,
        items: current.items.filter((l) => known(l.itemId)),
        bouquets: current.bouquets.map((b) => ({ ...b, stems: b.stems.filter((s) => known(s.itemId)) })),
      };
      toast({ tone: "error", text: "Часть позиций из отложенного чека скрыли на складе — они убраны из чека" });
    }
    if (addVitrineId && !current.vitrine.some((v) => v.bouquetId === addVitrineId)) {
      const b = vitrine.find((v) => v.id === addVitrineId);
      if (b) current = { ...current, vitrine: [...current.vitrine, vitrineLine(b)] };
    }
    setCheck(current);
    setParked(saved?.parked ?? []);
    setActiveKey(current.bouquets.at(-1)?.key ?? null);
    restored.current = true;
    if (addVitrineId) router.replace("/uchet/kassa");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembly]);

  useEffect(() => {
    if (restored.current && !assembly) save({ current: check, parked });
  }, [check, parked, assembly]);

  const update = (fn: (c: Check) => Check) => setCheck((c) => fn(c));

  // ---------------------------------------------------------------

  function addItem(item: KassaItem) {
    if (item.standalone && !assembly) {
      update((c) => {
        const existing = c.items.find((l) => l.itemId === item.id);
        return {
          ...c,
          items: existing
            ? c.items.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l))
            : [...c.items, { itemId: item.id, qty: 1, price: item.price ?? 0 }],
        };
      });
      if (!item.price) toast({ tone: "error", text: `У «${item.title}» нет цены — коснитесь суммы в чеке и поставьте` });
      return;
    }
    // Новый букет решаем здесь, а не внутри setCheck: функция обновления
    // должна быть чистой (React в разработке зовёт её дважды).
    let key = activeKey && check.bouquets.some((b) => b.key === activeKey) ? activeKey : null;
    const fresh = key ? null : newBouquet(check.bouquets.length + 1);
    if (fresh) {
      key = fresh.key;
      setActiveKey(fresh.key);
    }
    update((c) => ({
      ...c,
      bouquets: (fresh ? [...c.bouquets, fresh] : c.bouquets).map((b) => {
        if (b.key !== key) return b;
        const has = b.stems.find((s) => s.itemId === item.id);
        return {
          ...b,
          stems: has ? b.stems.map((s) => (s.itemId === item.id ? { ...s, qty: s.qty + 1 } : s)) : [...b.stems, { itemId: item.id, qty: 1 }],
        };
      }),
    }));
  }

  function stem(bouquetKey: string, itemId: string, delta: number) {
    update((c) => ({
      ...c,
      bouquets: c.bouquets.map((b) =>
        b.key !== bouquetKey ? b : { ...b, stems: b.stems.map((s) => (s.itemId === itemId ? { ...s, qty: s.qty + delta } : s)).filter((s) => s.qty > 0) }
      ),
    }));
  }

  function itemQty(itemId: string, delta: number) {
    update((c) => ({ ...c, items: c.items.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0) }));
  }

  function removeBouquet(key: string) {
    const removed = check.bouquets.find((b) => b.key === key);
    const before = check;
    update((c) => ({ ...c, bouquets: c.bouquets.filter((b) => b.key !== key) }));
    if (activeKey === key) setActiveKey(null);
    if (removed) toast({ tone: "ok", text: `${removed.title} убран из чека`, action: { label: "Вернуть", run: () => setCheck(before) } });
  }

  function newBouquetInCheck() {
    const b = newBouquet(check.bouquets.length + 1);
    update((c) => ({ ...c, bouquets: [...c.bouquets, b] }));
    setActiveKey(b.key);
  }

  function park() {
    setParked((p) => [...p, check]);
    setCheck(newCheck());
    setActiveKey(null);
    toast({ tone: "ok", text: "Чек отложен — он над новым чеком" });
  }

  function unpark(i: number) {
    const target = parked[i];
    setParked((p) => {
      const rest = p.filter((_, j) => j !== i);
      return isEmpty(check) ? rest : [...rest, check];
    });
    setCheck(target);
    setActiveKey(target.bouquets.at(-1)?.key ?? null);
  }

  async function pay(payments: { method: string; amount: number }[]) {
    setBusy(true);
    setError(null);
    const result = await recordSale(toSaleInput(check, index, payments));
    setBusy(false);
    if (!result.success) return setError(result.error);

    const amount = due(check, index);
    const noComposition = check.bouquets.filter((b) => b.stems.length === 0).length;
    setCheck(newCheck());
    setActiveKey(null);
    setDialog({
      kind: "done",
      text: `${result.data.saleNo}: оплачено ${formatMoney(amount)}`,
      note: noComposition
        ? `${noComposition === 1 ? "Букет без состава" : `${noComposition} букета без состава`} — цветы не списаны со склада.`
        : null,
    });
    router.refresh();
  }

  async function toVitrine(v: { title: string; price: number; photoUrls: string[] }) {
    const b = check.bouquets[0];
    if (!b) return;
    setBusy(true);
    setError(null);
    const result = await assembleBouquet({ id: b.key, title: v.title, price: v.price, items: b.stems, photoUrls: v.photoUrls, orderId: forOrder?.id ?? null });
    setBusy(false);
    if (!result.success) return setError(result.error);
    if (forOrder) {
      toast({ tone: "ok", text: `Букет к заказу ${forOrder.number} собран. Цветы списаны со склада` });
      router.push("/uchet/zakazy");
    } else {
      toast({ tone: "ok", text: `«${v.title || "Букет"}» на витрине. Цветы списаны со склада` });
      router.push("/uchet/vitrina");
    }
    router.refresh();
  }

  const takenVitrine = new Set(check.vitrine.map((v) => v.bouquetId));
  const priceTarget = dialog?.kind === "price" ? check.bouquets.find((b) => b.key === dialog.bouquetKey) : null;
  const itemTarget = dialog?.kind === "itemPrice" ? check.items.find((i) => i.itemId === dialog.itemId) : null;

  // Планшет и компьютер — две колонки, каждая прокручивается сама. Телефон —
  // одна страница: ассортимент, под ним чек.
  return (
    <div className="grid min-h-0 md:h-full md:grid-cols-[minmax(0,1fr)_380px] lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-h-0 p-4 md:overflow-y-auto">
        <Assortment
          assembly={assembly}
          items={items}
          groups={groups}
          frequent={frequent}
          vitrine={vitrine}
          query={query}
          onQuery={setQuery}
          group={group}
          onGroup={setGroup}
          onAdd={addItem}
          onOpenVitrine={() => setDialog({ kind: "vitrine" })}
          onPriceBouquet={() => setDialog({ kind: "priceBouquet" })}
        />
      </div>

      <CheckPanel
        assembly={assembly}
        check={check}
        index={index}
        activeKey={activeKey}
        parked={parked}
        shiftOpen={shiftOpen}
        onActivate={setActiveKey}
        onStem={stem}
        onBouquetPrice={(key) => setDialog({ kind: "price", bouquetKey: key })}
        onRemoveBouquet={removeBouquet}
        onRemoveVitrine={(key) => update((c) => ({ ...c, vitrine: c.vitrine.filter((v) => v.key !== key) }))}
        onItemQty={itemQty}
        onItemPrice={(itemId) => setDialog({ kind: "itemPrice", itemId })}
        onNewBouquet={newBouquetInCheck}
        onCustomer={() => setDialog({ kind: "customer" })}
        onDiscount={() => setDialog({ kind: "discount" })}
        onPark={park}
        onUnpark={unpark}
        onPay={() => {
          setError(null);
          setDialog({ kind: "pay" });
        }}
        onToVitrine={() => {
          setError(null);
          setDialog({ kind: "toVitrine" });
        }}
        onCancelAssembly={() => router.push(forOrder ? "/uchet/zakazy" : "/uchet/vitrina")}
        forOrder={forOrder}
      />

      {dialog?.kind === "pay" && (
        <PaySheet amount={due(check, index)} methods={methods} busy={busy} error={error} onPay={pay} onClose={() => setDialog(null)} />
      )}

      {priceTarget && (
        <AmountDialog
          title="Цена букета"
          hint={priceTarget.stems.length ? `По составу ${formatMoney(bouquetPrice({ ...priceTarget, manualPrice: null }, index))}. Можно поставить свою.` : "Состав не указан — цена вручную."}
          initial={bouquetPrice(priceTarget, index)}
          confirm="Готово"
          onClose={() => setDialog(null)}
          onDone={(v) => {
            update((c) => ({ ...c, bouquets: c.bouquets.map((b) => (b.key === priceTarget.key ? { ...b, manualPrice: v } : b)) }));
            setDialog(null);
          }}
        />
      )}

      {itemTarget && (
        <AmountDialog
          title={`Цена: ${index.get(itemTarget.itemId)?.title ?? ""}`}
          hint="За одну штуку"
          initial={itemTarget.price}
          confirm="Готово"
          onClose={() => setDialog(null)}
          onDone={(v) => {
            update((c) => ({ ...c, items: c.items.map((i) => (i.itemId === itemTarget.itemId ? { ...i, price: v } : i)) }));
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "priceBouquet" && (
        <AmountDialog
          title="Букет по цене"
          hint="Сумма, за которую продаёте. Состав можно добавить касаниями слева — тогда цветы спишутся со склада."
          initial={null}
          confirm="В чек"
          onClose={() => setDialog(null)}
          onDone={(v) => {
            const b: BouquetLine = { key: crypto.randomUUID(), title: `Букет за ${formatMoney(v)}`, manualPrice: v, stems: [] };
            update((c) => ({ ...c, bouquets: [...c.bouquets, b] }));
            setActiveKey(b.key);
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "discount" && (
        <DiscountDialog
          current={check.discountPercent}
          limit={settings.discountLimitPercent}
          approvers={approvers}
          onClose={() => setDialog(null)}
          onDone={(percent, approval) => {
            update((c) => ({ ...c, discountPercent: percent, approval: approval?.token ?? null, approvedBy: approval?.by ?? null }));
            setDialog(null);
            if (approval) toast({ tone: "ok", text: `Скидка ${percent}% подтверждена: ${approval.by}` });
          }}
        />
      )}

      {dialog?.kind === "customer" && (
        <CustomerPanel
          current={check.customer}
          bonusesEnabled={settings.bonusesEnabled}
          onPick={(customer) => update((c) => ({ ...c, customer }))}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "vitrine" && (
        <VitrinePicker
          bouquets={vitrine}
          taken={takenVitrine}
          onClose={() => setDialog(null)}
          onPick={(b) => {
            update((c) => ({ ...c, vitrine: [...c.vitrine, vitrineLine(b)] }));
            setDialog(null);
            toast({ tone: "ok", text: `«${b.title}» в чеке — осталось оплатить` });
          }}
        />
      )}

      {dialog?.kind === "toVitrine" && check.bouquets[0] && (
        <ToVitrineDialog
          forOrder={forOrder?.number ?? null}
          suggested={bouquetPrice(check.bouquets[0], index)}
          busy={busy}
          error={error}
          onClose={() => setDialog(null)}
          onDone={toVitrine}
        />
      )}

      {dialog?.kind === "done" && <DoneSheet text={dialog.text} note={dialog.note} onClose={() => setDialog(null)} />}
    </div>
  );
}
