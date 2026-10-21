"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { approveDiscount, searchCustomers, uploadBouquetPhoto } from "@/lib/uchet/pos-actions";
import type { CustomerHit, VitrineBouquet } from "@/lib/uchet/pos-queries";
import type { PickableEmployee } from "@/lib/uchet/people";
import { formatDate, formatMoney } from "@/lib/uchet/format";
import { prepareImageForUpload } from "@/lib/prepare-image";
import { ui } from "@/components/uchet/ui";
import { CloseButton, Dialog, Panel, Sheet } from "@/components/uchet/Overlay";
import { AmountDisplay, NumPad, PinDots } from "@/components/uchet/NumPad";
import { AgeBadge } from "@/components/uchet/vitrina/VitrineView";
import type { Customer } from "@/components/uchet/kassa/check";

// ---------------------------------------------------------------
// Сумма на цифровой клавиатуре: цена букета, «букет по цене», цена позиции
// ---------------------------------------------------------------

export function AmountDialog({
  title,
  hint,
  initial,
  confirm,
  onDone,
  onClose,
}: {
  title: string;
  hint?: string;
  initial: number | null;
  confirm: string;
  onDone: (value: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial ? String(Math.round(initial)) : "");
  return (
    <Dialog label={title} onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-zinc-500">{hint}</p>}
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="mt-4">
        <AmountDisplay value={value} />
      </div>
      <div className="mt-3">
        <NumPad value={value} onChange={setValue} />
      </div>
      <button type="button" disabled={!value || Number(value) <= 0} onClick={() => onDone(Number(value))} className={`${ui.btnPrimary} mt-4 min-h-[52px] w-full text-base`}>
        {confirm}
      </button>
    </Dialog>
  );
}

// ---------------------------------------------------------------
// Скидка. До лимита — сама, больше — PIN того, кому можно.
// ---------------------------------------------------------------

const PRESETS = [0, 5, 10, 15, 20];

export function DiscountDialog({
  current,
  limit,
  approvers,
  onDone,
  onClose,
}: {
  current: number;
  limit: number;
  approvers: PickableEmployee[];
  onDone: (percent: number, approval: { token: string; by: string } | null) => void;
  onClose: () => void;
}) {
  const [percent, setPercent] = useState(current);
  const [approver, setApprover] = useState<string | null>(approvers.length === 1 ? approvers[0].id : null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsApproval = percent > limit;

  useEffect(() => {
    if (!needsApproval || pin.length !== 4 || !approver) return;
    let cancelled = false;
    setBusy(true);
    approveDiscount(approver, pin, percent).then((r) => {
      if (cancelled) return;
      setBusy(false);
      setPin("");
      if (!r.success) return setError(r.error);
      onDone(percent, { token: r.data.approval, by: approvers.find((a) => a.id === approver)?.shortName ?? "" });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const presets = [...new Set([...PRESETS, limit])].sort((a, b) => a - b);

  return (
    <Dialog label="Скидка" onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Скидка</h2>
          <p className="mt-0.5 text-sm text-zinc-500">До {limit}% — сами. Больше — PIN администратора. Каждую скидку видит владелец.</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Размер скидки">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setPercent(p);
              setError(null);
              setPin("");
            }}
            aria-pressed={percent === p}
            className={`${ui.chip} ${percent === p ? ui.chipOn : ui.chipOff}`}
          >
            {p ? `${p}%` : "Без скидки"}
            {p > limit && <span className="text-xs opacity-60">· PIN</span>}
          </button>
        ))}
      </div>

      {needsApproval ? (
        approvers.length === 0 ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Подтверждать скидки пока некому: владелец отмечает таких людей в «Сотрудниках».
          </p>
        ) : (
          <div className="mt-4">
            <p className="mb-2 text-sm text-zinc-600">Кто подтверждает</p>
            <div className="flex flex-wrap gap-2">
              {approvers.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setApprover(a.id);
                    setPin("");
                    setError(null);
                  }}
                  aria-pressed={approver === a.id}
                  className={`${ui.chip} ${approver === a.id ? "bg-lavender-600 text-white" : ui.chipOff}`}
                >
                  {a.shortName}
                </button>
              ))}
            </div>
            {approver && (
              <div className="mt-4">
                <PinDots length={4} filled={pin.length} />
                <p className="mt-2 min-h-[1.25rem] text-center text-sm text-red-600" role="alert">
                  {busy ? <span className="text-zinc-500">Проверяем…</span> : error}
                </p>
                <NumPad value={pin} onChange={(v) => !busy && setPin(v)} maxLength={4} pin />
              </div>
            )}
          </div>
        )
      ) : (
        <button type="button" onClick={() => onDone(percent, null)} className={`${ui.btnPrimary} mt-5 min-h-[52px] w-full`}>
          {percent ? `Дать скидку ${percent}%` : "Без скидки"}
        </button>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------
// Клиент — по телефону
// ---------------------------------------------------------------

export function CustomerPanel({
  current,
  bonusesEnabled,
  onPick,
  onClose,
}: {
  current: Customer | null;
  bonusesEnabled: boolean;
  onPick: (c: Customer | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const digits = query.replace(/\D/g, "");
    if (digits.length < 4) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      setBusy(true);
      const found = await searchCustomers(query);
      if (!cancelled) {
        setHits(found);
        setBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query]);

  return (
    <Panel label="Клиент" onClose={onClose}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold">Клиент</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Последние цифры телефона — и видно, кто это и сколько бонусов.</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="space-y-3 p-5">
        <input
          id="customer-phone"
          type="tel"
          inputMode="tel"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="+7 978 …"
          aria-label="Телефон клиента"
          className={`${ui.field} h-12 text-lg`}
        />
        {!bonusesEnabled && (
          <p className="text-xs text-zinc-500">Бонусы пока ведёт Posiflora: здесь видно, сколько их, а списать и начислить — там.</p>
        )}
        {busy && <p className={ui.muted}>Ищем…</p>}
        {!busy && query.replace(/\D/g, "").length >= 4 && hits.length === 0 && <p className={ui.muted}>Не нашли. Проверьте номер.</p>}
        <ul className="space-y-2">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onPick({ id: h.id, name: h.name, phone: h.phone, bonusBalance: h.bonusBalance });
                  onClose();
                }}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left ring-1 ring-inset ring-zinc-200 transition hover:ring-lavender-300"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{h.name || "Без имени"}</span>
                  <span className="block text-xs text-zinc-500">
                    {h.phone}
                    {h.lastOrderAt && ` · заказывал(а) ${formatDate(h.lastOrderAt)}`}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-lavender-700">{formatMoney(h.bonusBalance)}</span>
              </button>
            </li>
          ))}
        </ul>
        {current && (
          <button
            type="button"
            onClick={() => {
              onPick(null);
              onClose();
            }}
            className={`${ui.btnSecondary} w-full`}
          >
            Без клиента
          </button>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------
// Витрина в кассе — сначала те, что стоят дольше
// ---------------------------------------------------------------

export function VitrinePicker({
  bouquets,
  taken,
  onPick,
  onClose,
}: {
  bouquets: VitrineBouquet[];
  taken: Set<string>;
  onPick: (b: VitrineBouquet) => void;
  onClose: () => void;
}) {
  const list = [...bouquets].sort((a, b) => a.assembledAt.localeCompare(b.assembledAt));
  return (
    <Sheet label="Витрина" onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Витрина</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Сначала — те, что стоят дольше.</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      {list.length === 0 ? (
        <p className="mt-6 text-center text-sm text-zinc-500">На витрине пусто.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {list.map((b) => {
            const inCheck = taken.has(b.id);
            return (
              <button
                key={b.id}
                type="button"
                disabled={inCheck}
                onClick={() => onPick(b)}
                className="overflow-hidden rounded-2xl text-left ring-1 ring-inset ring-zinc-200 transition hover:ring-lavender-300 disabled:opacity-40"
              >
                <span className="relative block aspect-[4/4.3] bg-zinc-100">
                  {b.photoUrls[0] && <Image src={b.photoUrls[0]} alt="" fill sizes="200px" className="object-cover" />}
                  <span className="absolute bottom-2 left-2 rounded-full bg-white px-2 py-0.5 text-sm font-bold tabular-nums">{formatMoney(b.price)}</span>
                  <span className="absolute right-2 top-2">
                    <AgeBadge days={b.days} />
                  </span>
                </span>
                <span className="block truncate px-3 py-2 text-sm font-semibold">{inCheck ? "уже в чеке" : b.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------
// На витрину: название, цена, фото
// ---------------------------------------------------------------

export function ToVitrineDialog({
  forOrder,
  suggested,
  busy,
  error,
  onDone,
  onClose,
}: {
  forOrder: string | null;
  suggested: number;
  busy: boolean;
  error: string | null;
  onDone: (v: { title: string; price: number; photoUrls: string[] }) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState(suggested ? String(Math.round(suggested)) : "");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setPhotoError(null);
    for (const f of Array.from(files).slice(0, 10 - photos.length)) {
      const prepared = await prepareImageForUpload(f);
      if (!prepared.ok) {
        setPhotoError(prepared.error);
        continue;
      }
      const fd = new FormData();
      fd.set("file", prepared.file);
      const up = await uploadBouquetPhoto(fd);
      if (!up.success) {
        setPhotoError(up.error);
        continue;
      }
      setPhotos((p) => [...p, up.data.url]);
    }
    setUploading(false);
  }

  return (
    <Sheet label={forOrder ? "К заказу" : "На витрину"} onClose={busy ? undefined : onClose} dismissible={!busy}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">{forOrder ? `Букет к заказу ${forOrder}` : "На витрину"}</h2>
          <p className="mt-0.5 text-sm text-zinc-500">По составу {formatMoney(suggested)}. Цену можно поставить свою.</p>
        </div>
        {!busy && <CloseButton onClose={onClose} />}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <input
            id="vitrine-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название, например «Нежный микс»"
            aria-label="Название букета"
            className={`${ui.field} h-12`}
          />
          <AmountDisplay value={price} />
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((u) => (
              <span key={u} className="relative h-16 w-16 overflow-hidden rounded-xl bg-zinc-100">
                <Image src={u} alt="" fill sizes="64px" className="object-cover" />
              </span>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex h-16 min-w-16 items-center justify-center rounded-xl border border-dashed border-lavender-300 bg-lavender-50 px-3 text-sm font-semibold text-lavender-700"
            >
              {uploading ? "…" : "+ Фото"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
          </div>
          {photoError && <p className="text-sm text-red-600">{photoError}</p>}
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <button
            type="button"
            disabled={busy || uploading || !price || Number(price) <= 0}
            onClick={() => onDone({ title, price: Number(price), photoUrls: photos })}
            className={`${ui.btnPrimary} min-h-[52px] w-full text-base`}
          >
            {busy ? "Сохраняем…" : forOrder ? "Готово — букет к заказу" : "Поставить на витрину"}
          </button>
        </div>
        <NumPad value={price} onChange={setPrice} />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------
// Оплачено
// ---------------------------------------------------------------

export function DoneSheet({ text, note, onClose }: { text: string; note: string | null; onClose: () => void }) {
  return (
    <Sheet label="Готово" onClose={onClose}>
      <div className="py-4 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <h2 className="mt-3 font-display text-xl font-bold">{text}</h2>
        {note && <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-600">{note}</p>}
      </div>
      <button type="button" onClick={onClose} className={`${ui.btnPrimary} min-h-[52px] w-full text-base`} autoFocus>
        Новая продажа
      </button>
    </Sheet>
  );
}
