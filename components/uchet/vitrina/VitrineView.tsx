"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { disassembleBouquet, updateVitrineBouquet, uploadBouquetPhoto, writeoffBouquet } from "@/lib/uchet/pos-actions";
import type { VitrineBouquet } from "@/lib/uchet/pos-queries";
import { formatMoney, formatQty } from "@/lib/uchet/format";
import { prepareImageForUpload } from "@/lib/prepare-image";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { CloseButton, Dialog, Panel } from "@/components/uchet/Overlay";
import { AmountDisplay, NumPad } from "@/components/uchet/NumPad";

type Sort = "old" | "price" | "new";

const SORTS: { key: Sort; label: string }[] = [
  { key: "old", label: "Сначала старые" },
  { key: "price", label: "Дороже" },
  { key: "new", label: "Свежие" },
];

const WRITEOFF_REASONS = ["Завял", "Сломался", "Подарили", "Другое"];

/**
 * Какой день букет на витрине, по календарю: собран сегодня — без метки,
 * вчера — «2-й день» жёлтым, раньше — «3-й день» и дальше красным.
 */
export function AgeBadge({ days }: { days: number }) {
  if (days <= 0) return null;
  const n = days + 1;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${n >= 3 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>
      {n}-й день
    </span>
  );
}

/**
 * Витрина. По умолчанию — сначала те, что стоят дольше: продать нужно их,
 * пока не завяли. У Posiflora витрина сортируется по новизне — наоборот.
 * Всё, что делается с букетом, — из карточки, без отдельной страницы.
 */
export function VitrineView({ bouquets, withCosts }: { bouquets: VitrineBouquet[]; withCosts: boolean }) {
  const [sort, setSort] = useState<Sort>("old");
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useMemo(() => {
    const copy = [...bouquets];
    if (sort === "old") copy.sort((a, b) => a.assembledAt.localeCompare(b.assembledAt));
    if (sort === "new") copy.sort((a, b) => b.assembledAt.localeCompare(a.assembledAt));
    if (sort === "price") copy.sort((a, b) => b.price - a.price);
    return copy;
  }, [bouquets, sort]);

  const total = bouquets.reduce((s, b) => s + b.price, 0);
  const old = bouquets.filter((b) => b.days >= 2).length;
  const open = openId ? bouquets.find((b) => b.id === openId) ?? null : null;

  return (
    <div className={ui.page}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p>
            <span className="font-display text-2xl font-bold tabular-nums">{bouquets.length}</span>{" "}
            <span className={ui.muted}>на витрине</span>
          </p>
          <p>
            <span className="font-display text-2xl font-bold tabular-nums">{formatMoney(total)}</span> <span className={ui.muted}>на сумму</span>
          </p>
          {old > 0 && (
            <p>
              <span className="font-display text-2xl font-bold tabular-nums text-red-600">{old}</span>{" "}
              <span className={ui.muted}>на 3-й день и дольше — продать первыми</span>
            </p>
          )}
        </div>
        <Link href="/uchet/kassa?mode=assembly" className={`${ui.btnPrimary} min-h-[48px]`}>
          + Собрать на витрину
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Порядок">
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSort(s.key)}
            aria-pressed={sort === s.key}
            className={`${ui.chip} ${sort === s.key ? ui.chipOn : ui.chipOff}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <section className={`${ui.cardPad} mt-6 text-center`}>
          <h2 className={ui.h2}>Витрина пуста</h2>
          <p className={`${ui.muted} mx-auto mt-1 max-w-md`}>
            Соберите букет — цветы спишутся со склада при сборке, а при продаже касса уже ничего не спишет.
          </p>
        </section>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.map((b) => (
            <article key={b.id} className={`${ui.card} flex flex-col overflow-hidden`}>
              <button type="button" onClick={() => setOpenId(b.id)} className="relative aspect-[4/4.3] bg-zinc-100" aria-label={`Подробнее: ${b.title}`}>
                {b.photoUrls[0] ? (
                  <Image src={b.photoUrls[0]} alt="" fill sizes="(min-width: 1280px) 20vw, (min-width: 640px) 33vw, 50vw" className="object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">без фото</span>
                )}
                <span className="absolute bottom-2 left-2 rounded-full bg-white px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">{formatMoney(b.price)}</span>
                <span className="absolute right-2 top-2">
                  <AgeBadge days={b.days} />
                </span>
              </button>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">{b.title}</p>
                  <p className="text-xs text-zinc-500">
                    {b.assembledBy ? `сборка: ${b.assembledBy}` : "собран"}
                    {withCosts && b.cost !== null && ` · себест. ${formatMoney(b.cost)}`}
                  </p>
                </div>
                <div className="mt-auto flex gap-2">
                  <Link href={`/uchet/kassa?vitrine=${b.id}`} className={`${ui.btnPrimary} min-h-[40px] flex-1 px-3`}>
                    Продать
                  </Link>
                  <button type="button" onClick={() => setOpenId(b.id)} className={`${ui.btnSecondary} min-h-[40px] px-3`} aria-label="Ещё">
                    ⋯
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {open && <BouquetPanel bouquet={open} withCosts={withCosts} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function BouquetPanel({ bouquet, withCosts, onClose }: { bouquet: VitrineBouquet; withCosts: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<null | "price" | "disassemble" | "writeoff">(null);
  const [price, setPrice] = useState(String(Math.round(bouquet.price)));
  const [reason, setReason] = useState(WRITEOFF_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ success: true } | { success: false; error: string }>, ok: string, close = true) {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result.success) return setError(result.error);
    toast({ tone: "ok", text: ok });
    setMode(null);
    if (close) onClose();
    router.refresh();
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const urls = [...bouquet.photoUrls];
    for (const f of Array.from(files).slice(0, 10 - urls.length)) {
      const prepared = await prepareImageForUpload(f);
      if (!prepared.ok) {
        setError(prepared.error);
        continue;
      }
      const fd = new FormData();
      fd.set("file", prepared.file);
      const up = await uploadBouquetPhoto(fd);
      if (!up.success) {
        setError(up.error);
        continue;
      }
      urls.push(up.data.url);
    }
    const saved = await updateVitrineBouquet(bouquet.id, { photoUrls: urls });
    setBusy(false);
    if (!saved.success) return setError(saved.error);
    toast({ tone: "ok", text: "Фото добавлено" });
    router.refresh();
  }

  const margin = withCosts && bouquet.cost !== null && bouquet.price > 0 ? Math.round(((bouquet.price - bouquet.cost) / bouquet.price) * 100) : null;

  return (
    <Panel label={bouquet.title} onClose={onClose}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold">{bouquet.title}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            {formatMoney(bouquet.price)}
            <AgeBadge days={bouquet.days} />
            {bouquet.assembledBy && <span>сборка: {bouquet.assembledBy}</span>}
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      <div className="flex-1 space-y-5 p-5">
        {bouquet.photoUrls.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {bouquet.photoUrls.map((u) => (
              <div key={u} className="relative aspect-square overflow-hidden rounded-xl bg-zinc-100">
                <Image src={u} alt="" fill sizes="140px" className="object-cover" />
              </div>
            ))}
          </div>
        )}

        <div>
          <p className={ui.label}>Состав</p>
          <ul className="mt-2 divide-y divide-zinc-100 text-sm">
            {bouquet.composition.map((c) => (
              <li key={c.itemId} className="flex justify-between py-1.5">
                <span>{c.title}</span>
                <span className="tabular-nums text-zinc-600">× {formatQty(c.qty)}</span>
              </li>
            ))}
          </ul>
          {withCosts && bouquet.cost !== null && (
            <p className="mt-2 text-sm text-zinc-500">
              Себестоимость {formatMoney(bouquet.cost)}
              {margin !== null && ` · прибыль ${formatMoney(bouquet.price - (bouquet.cost ?? 0))} (${margin}% цены)`}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Link href={`/uchet/kassa?vitrine=${bouquet.id}`} className={`${ui.btnPrimary} min-h-[48px]`}>
            Продать
          </Link>
          <button type="button" onClick={() => setMode("price")} className={`${ui.btnSecondary} min-h-[48px]`}>
            Изменить цену
          </button>
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={`${ui.btnSecondary} min-h-[48px]`}>
            {busy ? "Загружаем…" : "Добавить фото"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
          <button type="button" onClick={() => setMode("disassemble")} className={`${ui.btnSecondary} min-h-[48px]`}>
            Разобрать — цветы на склад
          </button>
          <button type="button" onClick={() => setMode("writeoff")} className={`${ui.btnDanger} min-h-[48px]`}>
            Списать
          </button>
        </div>
        {error && !mode && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {mode === "price" && (
        <Dialog label="Цена на витрине" onClose={() => setMode(null)}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-lg font-semibold">Цена на витрине</h3>
            <CloseButton onClose={() => setMode(null)} />
          </div>
          <div className="mt-4">
            <AmountDisplay value={price} />
          </div>
          <div className="mt-3">
            <NumPad value={price} onChange={setPrice} />
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => updateVitrineBouquet(bouquet.id, { price: Number(price || "0") }), "Цена изменена", false)}
            className={`${ui.btnPrimary} mt-4 min-h-[52px] w-full`}
          >
            Сохранить
          </button>
        </Dialog>
      )}

      {mode === "disassemble" && (
        <Dialog label="Разобрать букет" onClose={() => setMode(null)}>
          <h3 className="font-display text-lg font-semibold">Разобрать «{bouquet.title}»?</h3>
          <p className="mt-2 text-sm text-zinc-600">Цветы вернутся на склад по той цене, по которой ушли в букет. Букет пропадёт с витрины.</p>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode(null)} className={ui.btnSecondary}>
              Отмена
            </button>
            <button type="button" disabled={busy} onClick={() => run(() => disassembleBouquet(bouquet.id), "Букет разобран — цветы на складе")} className={ui.btnPrimary}>
              Разобрать
            </button>
          </div>
        </Dialog>
      )}

      {mode === "writeoff" && (
        <Dialog label="Списать букет" onClose={() => setMode(null)}>
          <h3 className="font-display text-lg font-semibold">Списать «{bouquet.title}»</h3>
          <p className="mt-1 text-sm text-zinc-600">Цветы ушли со склада ещё при сборке — списывается сам букет.</p>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Причина">
            {WRITEOFF_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} className={`${ui.chip} ${reason === r ? ui.chipOn : ui.chipOff}`}>
                {r}
              </button>
            ))}
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode(null)} className={ui.btnSecondary}>
              Отмена
            </button>
            <button type="button" disabled={busy} onClick={() => run(() => writeoffBouquet(bouquet.id, reason), "Букет списан")} className={ui.btnDanger}>
              Списать
            </button>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
