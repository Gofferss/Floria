"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KassaItem } from "@/lib/uchet/pos-queries";
import type { Recipe, RecipeProduct } from "@/lib/uchet/recipes";
import { recipePrice } from "@/lib/uchet/recipe-price";
import { cleanBouquetTitle } from "@/lib/uchet/recipe-names";
import {
  applyRecipeToSite,
  createSiteProductFromRecipe,
  importRecipesFromPosiflora,
  linkRecipeToProduct,
  saveRecipe,
  setRecipeActive,
  uploadRecipePhoto,
  type ImportReport,
} from "@/lib/uchet/recipe-actions";
import { prepareImageForUpload } from "@/lib/prepare-image";
import { formatMoney, formatQty } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { CloseButton, Dialog, Panel } from "@/components/uchet/Overlay";

// ================================================================
// Рецепты букетов: что собирают снова и снова.
//
// Карточка отвечает на три вопроса флориста: сколько стоит сейчас (цена
// по составу пересчитывается от цен цветов), можно ли собрать прямо сейчас
// (хватает ли свободных цветов — отложенные в чеках не в счёт) и что
// с ним делать: продать или собрать на витрину — одним касанием.
// ================================================================

type Props = {
  recipes: Recipe[];
  items: KassaItem[];
  products: RecipeProduct[];
  /** Себестоимость за штуку — только у владельцев, у остальных пусто. */
  costs: Record<string, number>;
  canSite: boolean;
  isOwner: boolean;
  isTraining: boolean;
};

type Shortage = { title: string; need: number; free: number };

function shortages(r: Recipe, index: Map<string, KassaItem>): Shortage[] {
  const out: Shortage[] = [];
  for (const l of r.items) {
    const it = index.get(l.itemId);
    if (!it || !it.isTracked) continue;
    const free = it.qty - it.held;
    if (free < l.qty) out.push({ title: it.title, need: l.qty, free: Math.max(0, free) });
  }
  return out;
}

export function RecipesView({ recipes, items, products, costs, canSite, isOwner, isTraining }: Props) {
  const router = useRouter();
  const toast = useToast();
  const index = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [showHidden, setShowHidden] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Recipe | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const q = query.trim().toLowerCase();
  const visible = recipes.filter((r) => (showHidden || r.isActive) && (!q || `${r.title} ${r.nickname ?? ""}`.toLowerCase().includes(q)));
  const hiddenCount = recipes.filter((r) => !r.isActive).length;

  // Одинаковые названия на сайте путают покупателя — подсказать маленькое название.
  const sameTitle = new Map<string, number>();
  for (const r of recipes.filter((x) => x.isActive)) sameTitle.set(r.title.toLowerCase(), (sameTitle.get(r.title.toLowerCase()) ?? 0) + 1);

  async function runImport() {
    setImporting(true);
    const res = await importRecipesFromPosiflora().catch(() => ({ success: false as const, error: "Нет связи с сервером" }));
    setImporting(false);
    setImportOpen(false);
    if (!res.success) return toast({ tone: "error", text: res.error });
    setReport(res.data);
    router.refresh();
  }

  return (
    <div className={ui.page}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={ui.h1}>Рецепты</h1>
          <p className={`${ui.muted} mt-1 max-w-2xl`}>
            Букеты, которые собирают снова и снова. Цена по составу меняется вместе с ценами цветов. Из рецепта — сразу в чек или на витрину.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSite && (
            <button type="button" onClick={() => setImportOpen(true)} className={ui.btnSecondary}>
              Загрузить из Posiflora
            </button>
          )}
          <button type="button" onClick={() => setEditing("new")} className={ui.btnPrimary}>
            + Новый рецепт
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          id="recipes-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск: название"
          aria-label="Поиск рецепта"
          className={`${ui.fieldSm} max-w-xs`}
        />
        {hiddenCount > 0 && (
          <button type="button" onClick={() => setShowHidden((v) => !v)} aria-pressed={showHidden} className={`${ui.chip} ${showHidden ? ui.chipOn : ui.chipOff}`}>
            Скрытые · {hiddenCount}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className={`${ui.cardPad} mt-6 text-center`}>
          <p className="font-display text-base font-semibold text-zinc-900">{recipes.length ? "Ничего не нашлось" : "Рецептов пока нет"}</p>
          <p className={`${ui.muted} mx-auto mt-1 max-w-md`}>
            {recipes.length
              ? "Попробуйте часть слова."
              : canSite
                ? "Заведите первый рецепт или загрузите те, что уже собраны в Posiflora."
                : "Заведите первый рецепт: состав, фото и цена."}
          </p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {visible.map((r) => {
            const price = recipePrice(r, (id) => index.get(id)?.price);
            const short = shortages(r, index);
            const missing = r.items.filter((l) => !index.has(l.itemId)).length;
            const siteDiff = r.product && Math.round(r.product.price) !== Math.round(price.price);
            const dup = (sameTitle.get(r.title.toLowerCase()) ?? 0) > 1 && !r.nickname;
            return (
              <article key={r.id} className={`${ui.card} flex flex-col overflow-hidden ${r.isActive ? "" : "opacity-60"}`}>
                <button type="button" onClick={() => setEditing(r)} className="relative block aspect-[4/3.4] bg-zinc-100 text-left" aria-label={`Изменить «${r.title}»`}>
                  {r.photoUrl ? (
                    <Image src={r.photoUrl} alt="" fill sizes="(min-width: 1024px) 280px, 50vw" className="object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">без фото</span>
                  )}
                  <span className="absolute bottom-2 left-2 rounded-full bg-white px-2.5 py-0.5 font-display text-base font-bold tabular-nums shadow-sm">{formatMoney(price.price)}</span>
                  {!r.isActive && <span className="absolute right-2 top-2 rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-semibold text-white">скрыт</span>}
                </button>
                <div className="flex flex-1 flex-col gap-2 p-3.5">
                  <div>
                    <h2 className="font-display text-[15px] font-semibold leading-snug text-zinc-900">{r.title}</h2>
                    {r.nickname && <p className="mt-0.5 text-xs text-zinc-500">«{r.nickname}»</p>}
                  </div>
                  <p className="line-clamp-2 text-xs text-zinc-600">
                    {r.items.map((l) => `${index.get(l.itemId)?.title ?? "—"} ${formatQty(l.qty)}`).join(" · ")}
                  </p>
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">{r.priceMode === "fixed" ? "своя цена" : "цена по составу"}</span>
                    {short.length === 0 && missing === 0 ? (
                      <span className="rounded-full bg-leaf-50 px-2 py-0.5 text-leaf-700">можно собрать</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900" title={short.map((s) => `${s.title}: нужно ${formatQty(s.need)}, свободно ${formatQty(s.free)}`).join("\n")}>
                        {missing > 0 ? "позиции нет в кассе" : `не хватает: ${short[0].title.toLowerCase()}${short.length > 1 ? ` и ещё ${short.length - 1}` : ""}`}
                      </span>
                    )}
                    {price.unpriced.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">без цены: {price.unpriced.length}</span>}
                    {canSite && (r.product ? (
                      <span className={`rounded-full px-2 py-0.5 ${siteDiff ? "bg-amber-100 text-amber-900" : "bg-lavender-100 text-lavender-700"}`}>
                        на сайте {formatMoney(r.product.price)}{siteDiff ? " — другая цена" : ""}
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-500">не на сайте</span>
                    ))}
                    {dup && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">похожее название — нужно маленькое</span>}
                  </div>
                  <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
                    <Link href={`/uchet/kassa?recipe=${r.id}`} className={`${ui.btnSell} min-h-[40px] px-3`}>
                      Продать
                    </Link>
                    <Link href={`/uchet/kassa?mode=assembly&recipe=${r.id}`} className={`${ui.btnSecondary} min-h-[40px] px-3`}>
                      На витрину
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {isTraining && canSite && (
        <p className={`${ui.muted} mt-6 max-w-2xl`}>
          Учёт ещё не запущен: цены цветов ведёт Posiflora. «Загрузить из Posiflora» заодно обновляет цены и названия позиций из рецептов — так цена по составу совпадает с той, что там.
        </p>
      )}

      {editing && (
        <RecipeEditor
          recipe={editing === "new" ? null : editing}
          items={items}
          index={index}
          products={products}
          costs={costs}
          canSite={canSite}
          isOwner={isOwner}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {importOpen && (
        <Dialog label="Загрузить из Posiflora" onClose={importing ? undefined : () => setImportOpen(false)} dismissible={!importing}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">Загрузить рецепты из Posiflora</h2>
            {!importing && <CloseButton onClose={() => setImportOpen(false)} />}
          </div>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-zinc-700">
            <li>Перенесутся рецепты, которых здесь ещё нет. Уже перенесённые не трогаются.</li>
            <li>Название — «Букет из …» без зелени и сухоцветов. Фото, состав и цена — как в Posiflora.</li>
            <li>Цветы, которых нет на складе учёта, заведутся.{isTraining ? " Пока учёт не запущен, у цветов из рецептов обновятся названия и цены по Posiflora." : ""}</li>
            <li>Букет на сайте свяжется сам, если фото совпало. Сайт сам не меняется — это отдельная кнопка в рецепте.</li>
            <li>В Posiflora ничего не меняется: оттуда только читаем.</li>
          </ul>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" disabled={importing} onClick={() => setImportOpen(false)} className={ui.btnCancel}>
              Отмена
            </button>
            <button type="button" disabled={importing} onClick={runImport} className={ui.btnPrimary}>
              {importing ? "Загружаем… до минуты" : "Загрузить"}
            </button>
          </div>
        </Dialog>
      )}

      {report && (
        <Dialog label="Итог загрузки" onClose={() => setReport(null)}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">
              {report.created.length ? `Перенесено рецептов: ${report.created.length}` : "Новых рецептов нет"}
            </h2>
            <CloseButton onClose={() => setReport(null)} />
          </div>
          <div className="mt-3 space-y-3 text-sm text-zinc-700">
            {report.created.length > 0 && <p>Связано с букетами сайта по фото: {report.linked} из {report.created.length}.</p>}
            {report.skipped > 0 && <p>Уже были здесь и не тронуты: {report.skipped}.</p>}
            {report.itemsCreated.length > 0 && <p>Заведены позиции склада: {report.itemsCreated.join(", ")}.</p>}
            {report.itemsRefreshed.length > 0 && (
              <details>
                <summary className="cursor-pointer font-semibold">Обновлены позиции по Posiflora: {report.itemsRefreshed.length}</summary>
                <ul className="mt-1 list-disc pl-5">{report.itemsRefreshed.map((t) => <li key={t}>{t}</li>)}</ul>
              </details>
            )}
            {report.problems.length > 0 && (
              <div className="rounded-xl bg-amber-50 p-3 text-amber-900">
                <p className="font-semibold">Что не вышло:</p>
                <ul className="mt-1 list-disc pl-5">{report.problems.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            )}
          </div>
          <button type="button" onClick={() => setReport(null)} className={`${ui.btnPrimary} mt-5 w-full`}>
            Понятно
          </button>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Рецепт: название, фото, состав, цена, связь с сайтом
// ---------------------------------------------------------------

function RecipeEditor({
  recipe,
  items,
  index,
  products,
  costs,
  canSite,
  isOwner,
  onClose,
  onSaved,
}: {
  recipe: Recipe | null;
  items: KassaItem[];
  index: Map<string, KassaItem>;
  products: RecipeProduct[];
  costs: Record<string, number>;
  canSite: boolean;
  isOwner: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(recipe?.title ?? "Букет из ");
  const [nickname, setNickname] = useState(recipe?.nickname ?? "");
  const [photo, setPhoto] = useState<string | null>(recipe?.photoUrl ?? null);
  const [lines, setLines] = useState(recipe?.items ?? []);
  const [mode, setMode] = useState<"composition" | "fixed">(recipe?.priceMode ?? "composition");
  const [fixed, setFixed] = useState(recipe?.fixedPrice ? String(Math.round(recipe.fixedPrice)) : "");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productId, setProductId] = useState(recipe?.productId ?? "");

  const price = recipePrice({ priceMode: mode, fixedPrice: mode === "fixed" ? Number(fixed) || null : null, items: lines }, (id) => index.get(id)?.price);
  const cost = isOwner ? lines.reduce((s, l) => s + (costs[l.itemId] ?? 0) * l.qty, 0) : 0;
  const suggestion = cleanBouquetTitle(title);
  const q = search.trim().toLowerCase();
  const found = q ? items.filter((i) => i.title.toLowerCase().includes(q) && !lines.some((l) => l.itemId === i.id)).slice(0, 12) : [];
  const dirty =
    !recipe ||
    title !== recipe.title ||
    nickname !== (recipe.nickname ?? "") ||
    photo !== recipe.photoUrl ||
    mode !== recipe.priceMode ||
    (mode === "fixed" && Number(fixed) !== recipe.fixedPrice) ||
    JSON.stringify(lines) !== JSON.stringify(recipe.items);

  function qty(itemId: string, delta: number) {
    setLines((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, qty: Math.max(0, l.qty + delta) } : l)).filter((l) => l.qty > 0));
  }

  async function addPhoto(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    setError(null);
    const prepared = await prepareImageForUpload(f);
    if (!prepared.ok) {
      setUploading(false);
      return setError(prepared.error);
    }
    const fd = new FormData();
    fd.set("file", prepared.file);
    const up = await uploadRecipePhoto(fd).catch(() => ({ success: false as const, error: "Нет связи — фото не загрузилось" }));
    setUploading(false);
    if (!up.success) return setError(up.error);
    setPhoto(up.data.url);
  }

  async function save(): Promise<string | null> {
    setBusy(true);
    setError(null);
    const res = await saveRecipe({
      id: recipe?.id ?? null,
      title,
      nickname,
      photoUrl: photo,
      priceMode: mode,
      fixedPrice: mode === "fixed" ? Number(fixed) || null : null,
      items: lines,
    }).catch(() => ({ success: false as const, error: "Нет связи — рецепт не сохранён" }));
    setBusy(false);
    if (!res.success) {
      setError(res.error);
      return null;
    }
    return res.data.id;
  }

  async function siteAction(kind: "link" | "apply" | "create") {
    if (!recipe) return;
    // Сайт берёт рецепт из базы — несохранённые правки сначала сохраняем.
    if (dirty && !(await save())) return;
    setBusy(true);
    setError(null);
    const res =
      kind === "link"
        ? await linkRecipeToProduct(recipe.id, productId || null)
        : kind === "apply"
          ? await applyRecipeToSite(recipe.id)
          : await createSiteProductFromRecipe(recipe.id);
    setBusy(false);
    if (!res.success) return setError(res.error);
    toast({ tone: "ok", text: kind === "link" ? (productId ? "Рецепт связан с букетом на сайте" : "Связь с сайтом снята") : kind === "apply" ? "Букет на сайте обновлён по рецепту" : "Букет создан на сайте" });
    router.refresh();
    if (kind !== "link") onSaved();
  }

  async function toggleActive() {
    if (!recipe) return;
    setBusy(true);
    const res = await setRecipeActive(recipe.id, !recipe.isActive);
    setBusy(false);
    if (!res.success) return setError(res.error);
    toast({ tone: "ok", text: recipe.isActive ? "Рецепт скрыт — его не видно в кассе" : "Рецепт снова виден" });
    onSaved();
  }

  const linked = products.find((p) => p.id === (recipe?.productId ?? "")) ?? recipe?.product ?? null;

  return (
    <Panel label={recipe ? "Рецепт" : "Новый рецепт"} onClose={busy ? undefined : onClose} dismissible={!busy}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-100 p-4">
        <h2 className="font-display text-lg font-semibold">{recipe ? "Рецепт" : "Новый рецепт"}</h2>
        {!busy && <CloseButton onClose={onClose} />}
      </div>

      <div className="flex-1 space-y-5 p-4">
        <div className="flex gap-3">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="relative h-28 w-24 shrink-0 overflow-hidden rounded-xl bg-zinc-100 text-xs font-semibold text-lavender-700 ring-1 ring-inset ring-zinc-200">
            {photo ? <Image src={photo} alt="" fill sizes="96px" className="object-cover" /> : <span className="absolute inset-0 flex items-center justify-center px-2 text-center">{uploading ? "…" : "+ Фото"}</span>}
            {photo && <span className="absolute inset-x-0 bottom-0 bg-black/50 py-1 text-center text-[11px] text-white">{uploading ? "…" : "заменить"}</span>}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => addPhoto(e.target.files)} />
          <div className="min-w-0 flex-1 space-y-2">
            <label className="block">
              <span className={ui.label}>Название</span>
              <input id="recipe-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className={`${ui.fieldSm} mt-1`} />
            </label>
            {suggestion !== title.replace(/\s+/g, " ").trim() && suggestion.length > 9 && (
              <p className="text-xs text-zinc-500">
                Без зелени в названии: «{suggestion}».{" "}
                <button type="button" onClick={() => setTitle(suggestion)} className="font-semibold text-lavender-700 underline underline-offset-2">
                  Взять
                </button>
              </p>
            )}
            <label className="block">
              <span className={ui.label}>Маленькое название</span>
              <input id="recipe-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={60} placeholder="Солнышко — необязательно" className={`${ui.fieldSm} mt-1`} />
            </label>
          </div>
        </div>

        <section>
          <h3 className={ui.label}>Состав</h3>
          <div className="mt-2 divide-y divide-zinc-100 rounded-xl ring-1 ring-inset ring-zinc-200">
            {lines.length === 0 && <p className="px-3 py-4 text-center text-sm text-zinc-400">Найдите цветы ниже и добавьте касанием.</p>}
            {lines.map((l) => {
              const it = index.get(l.itemId);
              return (
                <div key={l.itemId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{it?.title ?? "позиции нет в кассе"}</span>
                    <span className="block text-xs tabular-nums text-zinc-500">{it?.price ? `${formatMoney(it.price)}/шт · ${formatMoney(it.price * l.qty)}` : "без цены"}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <button type="button" onClick={() => qty(l.itemId, -1)} className="h-8 w-8 rounded-lg bg-zinc-100 font-bold" aria-label="Меньше">−</button>
                    <span className="min-w-[2rem] text-center font-semibold tabular-nums">{formatQty(l.qty)}</span>
                    <button type="button" onClick={() => qty(l.itemId, 1)} className="h-8 w-8 rounded-lg bg-zinc-100 font-bold" aria-label="Больше">+</button>
                  </span>
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.itemId !== l.itemId))} className={ui.btnRemove} aria-label="Убрать из состава">✕</button>
                </div>
              );
            })}
          </div>
          <input
            id="recipe-item-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Добавить: роза, хризантема, упаковка…"
            aria-label="Найти позицию склада"
            className={`${ui.fieldSm} mt-2`}
          />
          {found.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {found.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => {
                    setLines((ls) => [...ls, { itemId: i.id, qty: 1 }]);
                    setSearch("");
                  }}
                  className="truncate rounded-lg bg-white px-2.5 py-2 text-left text-xs ring-1 ring-inset ring-zinc-200 hover:ring-lavender-300"
                >
                  <span className="font-medium">{i.title}</span>
                  <span className="text-zinc-500"> · {i.price ? formatMoney(i.price) : "—"}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className={ui.label}>Цена</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setMode("composition")} aria-pressed={mode === "composition"} className={`${ui.chip} ${mode === "composition" ? ui.chipOn : ui.chipOff}`}>
              По составу · {formatMoney(price.composition)}
            </button>
            <button type="button" onClick={() => setMode("fixed")} aria-pressed={mode === "fixed"} className={`${ui.chip} ${mode === "fixed" ? ui.chipOn : ui.chipOff}`}>
              Своя цена
            </button>
            {mode === "fixed" && (
              <input id="recipe-fixed" inputMode="numeric" value={fixed} onChange={(e) => setFixed(e.target.value.replace(/\D/g, ""))} placeholder="₽" aria-label="Своя цена" className={`${ui.fieldInline} w-28`} />
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {mode === "composition" ? "Меняется сама, когда меняются цены цветов на складе." : "Не зависит от цен цветов."}
            {recipe?.posifloraPrice ? ` В Posiflora было ${formatMoney(recipe.posifloraPrice)}.` : ""}
          </p>
          {price.unpriced.length > 0 && <p className="mt-1 text-xs font-semibold text-amber-800">У {price.unpriced.length} позиций нет цены — по составу посчитано без них.</p>}
          {isOwner && cost > 0 && price.price > 0 && (
            <p className="mt-1 text-xs text-zinc-500">
              Себестоимость {formatMoney(cost)} · наценка ×{(price.price / cost).toFixed(1).replace(".", ",")}
            </p>
          )}
        </section>

        {canSite && recipe && (
          <section className="rounded-xl bg-lavender-50 p-3">
            <h3 className={ui.label}>На сайте</h3>
            {linked ? (
              <div className="mt-2 flex items-center gap-3">
                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-100">{linked.image && <Image src={linked.image} alt="" fill sizes="48px" className="object-cover" />}</span>
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-semibold">{linked.name}</span>
                  <span className="block text-xs text-zinc-500">
                    {formatMoney(linked.price)} на сайте · по рецепту {formatMoney(price.price)}
                  </span>
                </span>
              </div>
            ) : (
              <p className="mt-1 text-sm text-zinc-600">Рецепт не связан с букетом на сайте.</p>
            )}
            <select
              id="recipe-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              aria-label="Букет на сайте"
              className={`${ui.fieldSm} mt-2`}
            >
              <option value="">— не связан —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.nickname ? ` «${p.nickname}»` : ""} · {formatMoney(p.price)}{p.isActive ? "" : " (скрыт)"}
                </option>
              ))}
            </select>
            <div className="mt-2 flex flex-wrap gap-2">
              {productId !== (recipe.productId ?? "") && (
                <button type="button" disabled={busy} onClick={() => siteAction("link")} className={ui.btnSecondary}>
                  Сохранить связь
                </button>
              )}
              {recipe.productId && productId === recipe.productId && (
                <button type="button" disabled={busy} onClick={() => siteAction("apply")} className={ui.btnPrimary}>
                  Обновить на сайте
                </button>
              )}
              {!recipe.productId && !productId && (
                <button type="button" disabled={busy} onClick={() => siteAction("create")} className={ui.btnSecondary}>
                  Создать букет на сайте
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-zinc-500">«Обновить» меняет на сайте название, маленькое название, цену и состав. Фото и раздел каталога остаются как есть.</p>
          </section>
        )}

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </div>

      <div className="sticky bottom-0 flex gap-2 border-t border-zinc-200 bg-white p-4">
        {recipe && (
          <button type="button" disabled={busy} onClick={toggleActive} className={recipe.isActive ? ui.btnCancel : ui.btnSecondary}>
            {recipe.isActive ? "Скрыть" : "Вернуть"}
          </button>
        )}
        <button
          type="button"
          disabled={busy || uploading || !dirty}
          onClick={async () => {
            if (await save()) {
              toast({ tone: "ok", text: "Рецепт сохранён" });
              onSaved();
            }
          }}
          className={`${ui.btnPrimary} flex-1`}
        >
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </Panel>
  );
}
