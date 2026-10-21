"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveGroup, saveReason, saveSupplier } from "@/lib/uchet/actions";
import type { GroupOption, ReasonOption, SupplierOption } from "@/lib/uchet/queries";
import { KINDS, KIND_LABEL, type GroupKind } from "@/lib/uchet/format";
import { GROUP_ICONS, GROUP_ICON_KEYS, GroupIcon } from "@/components/uchet/GroupIcon";

// ================================================================
// Справочники склада. Удаления нет намеренно: на группу, поставщика или
// причину могут ссылаться проведённые документы, и удаление стёрло бы
// смысл истории. Ненужное выключают — оно пропадает из списков выбора,
// а в старых документах остаётся.
// ================================================================

const field =
  "w-full rounded-xl border border-zinc-300 bg-lavender-50 px-3 py-2 font-body text-sm text-ink outline-none focus:border-gold-400 focus:bg-white";
const saveBtn =
  "rounded-full bg-lavender-600 px-4 py-2 font-display text-xs font-semibold text-white transition hover:bg-lavender-700 disabled:opacity-40";

type SaveResult = { success: true } | { success: false; error: string };

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<SaveResult>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result.success) return setError(result.error);
    onDone?.();
    router.refresh();
  }
  return { busy, error, run };
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8">
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-1 max-w-2xl font-body text-sm text-ink/55">{hint}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------

/** Значок группы: касание — сетка значков, касание по значку — выбран. */
function IconPicker({ value, onChange, id }: { value: string | null; onChange: (icon: string) => void; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Значок группы"
        title="Сменить значок"
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-lavender-50 text-lavender-700 ring-1 ring-inset ring-lavender-200 transition hover:ring-lavender-400"
      >
        <GroupIcon icon={value} />
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-20 grid w-[17rem] grid-cols-6 gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl" role="listbox" aria-label="Значки">
          {GROUP_ICON_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={value === k}
              title={GROUP_ICONS[k].title}
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition ${value === k ? "bg-lavender-600 text-white" : "text-zinc-700 hover:bg-lavender-50"}`}
            >
              <GroupIcon icon={k} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupRow({ group }: { group: GroupOption }) {
  const [title, setTitle] = useState(group.title);
  const [kind, setKind] = useState<GroupKind>(group.kind);
  const [icon, setIcon] = useState(group.icon);
  const [active, setActive] = useState(group.isActive);
  const { busy, error, run } = useSave();
  const dirty = title !== group.title || kind !== group.kind || icon !== group.icon || active !== group.isActive;

  return (
    <li className="grid grid-cols-1 items-center gap-2 py-3 sm:grid-cols-[auto_1fr_13rem_auto_auto]">
      <IconPicker id={`g-icon-${group.id}`} value={icon} onChange={setIcon} />
      <input id={`g-title-${group.id}`} aria-label="Название группы" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      <select id={`g-kind-${group.id}`} aria-label="Вид" value={kind} onChange={(e) => setKind(e.target.value as GroupKind)} className={field}>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <label htmlFor={`g-active-${group.id}`} className="flex items-center gap-2 font-body text-sm text-ink/70">
        <input id={`g-active-${group.id}`} type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-lavender-600" />
        действует
      </label>
      <button
        type="button"
        disabled={!dirty || busy}
        onClick={() => run(() => saveGroup({ id: group.id, title, kind, icon, isActive: active }))}
        className={saveBtn}
      >
        {busy ? "…" : "Сохранить"}
      </button>
      {error && <p className="font-body text-xs text-red-600 sm:col-span-5">{error}</p>}
    </li>
  );
}

export function GroupsEditor({ groups }: { groups: GroupOption[] }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<GroupKind>("flower");
  const { busy, error, run } = useSave();

  return (
    <Section
      title="Группы"
      hint="Значок — чтобы группу узнавали с одного взгляда в кассе и на складе. Вид нужен системе: срок свежести подсвечивается у цветов и зелени, у услуг остаток не ведётся."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveGroup({ title, kind, isActive: true }), () => setTitle(""));
        }}
        className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_13rem_auto]"
      >
        <input id="g-new-title" aria-label="Новая группа" placeholder="Новая группа" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
        <select id="g-new-kind" aria-label="Вид новой группы" value={kind} onChange={(e) => setKind(e.target.value as GroupKind)} className={field}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!title.trim() || busy} className={saveBtn}>
          Добавить
        </button>
      </form>
      {error && <p className="mt-2 font-body text-xs text-red-600">{error}</p>}
      <ul className="mt-4 divide-y divide-zinc-200">
        {groups.map((g) => (
          <GroupRow key={g.id} group={g} />
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------

function SupplierRow({ supplier }: { supplier: SupplierOption }) {
  const [title, setTitle] = useState(supplier.title);
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [active, setActive] = useState(supplier.isActive);
  const { busy, error, run } = useSave();
  const dirty = title !== supplier.title || phone !== (supplier.phone ?? "") || active !== supplier.isActive;

  return (
    <li className="grid grid-cols-1 items-center gap-2 py-3 sm:grid-cols-[1fr_13rem_auto_auto]">
      <input id={`s-title-${supplier.id}`} aria-label="Поставщик" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      <input id={`s-phone-${supplier.id}`} aria-label="Телефон" placeholder="Телефон" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
      <label htmlFor={`s-active-${supplier.id}`} className="flex items-center gap-2 font-body text-sm text-ink/70">
        <input id={`s-active-${supplier.id}`} type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-lavender-600" />
        действует
      </label>
      <button
        type="button"
        disabled={!dirty || busy}
        onClick={() => run(() => saveSupplier({ id: supplier.id, title, phone: phone || null, notes: supplier.notes, isActive: active }))}
        className={saveBtn}
      >
        {busy ? "…" : "Сохранить"}
      </button>
      {error && <p className="font-body text-xs text-red-600 sm:col-span-4">{error}</p>}
    </li>
  );
}

export function SuppliersEditor({ suppliers }: { suppliers: SupplierOption[] }) {
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const { busy, error, run } = useSave();

  return (
    <Section title="Поставщики" hint="Необязательны в приходе. Но если указывать, в отчётах станет видно, у кого цветы стоят дольше.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveSupplier({ title, phone: phone || null, notes: null, isActive: true }), () => {
            setTitle("");
            setPhone("");
          });
        }}
        className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_13rem_auto]"
      >
        <input id="s-new-title" aria-label="Новый поставщик" placeholder="Новый поставщик" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
        <input id="s-new-phone" aria-label="Телефон нового поставщика" placeholder="Телефон" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
        <button type="submit" disabled={!title.trim() || busy} className={saveBtn}>
          Добавить
        </button>
      </form>
      {error && <p className="mt-2 font-body text-xs text-red-600">{error}</p>}
      {suppliers.length === 0 ? (
        <p className="mt-4 font-body text-sm text-ink/45">Пока никого.</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200">
          {suppliers.map((s) => (
            <SupplierRow key={s.id} supplier={s} />
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------

function ReasonRow({ reason }: { reason: ReasonOption }) {
  const [title, setTitle] = useState(reason.title);
  const [active, setActive] = useState(reason.isActive);
  const { busy, error, run } = useSave();
  const dirty = title !== reason.title || active !== reason.isActive;

  return (
    <li className="grid grid-cols-1 items-center gap-2 py-3 sm:grid-cols-[1fr_auto_auto]">
      <input id={`r-title-${reason.id}`} aria-label="Причина" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      <label htmlFor={`r-active-${reason.id}`} className="flex items-center gap-2 font-body text-sm text-ink/70">
        <input id={`r-active-${reason.id}`} type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-lavender-600" />
        действует
      </label>
      <button
        type="button"
        disabled={!dirty || busy}
        onClick={() => run(() => saveReason({ id: reason.id, title, isActive: active }))}
        className={saveBtn}
      >
        {busy ? "…" : "Сохранить"}
      </button>
      {error && <p className="font-body text-xs text-red-600 sm:col-span-3">{error}</p>}
    </li>
  );
}

export function ReasonsEditor({ reasons }: { reasons: ReasonOption[] }) {
  const [title, setTitle] = useState("");
  const { busy, error, run } = useSave();

  return (
    <Section title="Причины списания" hint="Из них складывается отчёт по списаниям: сколько ушло завявшим, сколько — на нужды студии.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveReason({ title, isActive: true }), () => setTitle(""));
        }}
        className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]"
      >
        <input id="r-new-title" aria-label="Новая причина" placeholder="Новая причина" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
        <button type="submit" disabled={!title.trim() || busy} className={saveBtn}>
          Добавить
        </button>
      </form>
      {error && <p className="mt-2 font-body text-xs text-red-600">{error}</p>}
      <ul className="mt-4 divide-y divide-zinc-200">
        {reasons.map((r) => (
          <ReasonRow key={r.id} reason={r} />
        ))}
      </ul>
    </Section>
  );
}
