"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PosSettings } from "@/lib/uchet/pos-queries";
import type { CashReasonKind, CashReasonRow, PaymentMethodRow } from "@/lib/uchet/settings-queries";
import { saveCashReason, savePaymentMethod, savePosRules } from "@/lib/uchet/settings-actions";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";

type Run = (fn: () => Promise<{ success: true } | { success: false; error: string }>, ok?: string) => Promise<boolean>;

function useRun(): [Run, boolean] {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run: Run = async (fn, ok) => {
    setBusy(true);
    const result = await fn().catch((e: unknown) => ({ success: false as const, error: e instanceof Error ? e.message : "Не получилось — обновите страницу" }));
    setBusy(false);
    if (!result.success) {
      toast({ tone: "error", text: result.error });
      return false;
    }
    if (ok) toast({ tone: "ok", text: ok });
    router.refresh();
    return true;
  };
  return [run, busy];
}

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40 ${checked ? "bg-lavender-600" : "bg-zinc-300"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/**
 * Настройки владельца: правила кассы и её справочники. Всё, что говорится
 * фразой («скидку больше 10% — только с подтверждением»), меняется здесь,
 * а не в коде.
 */
export function SettingsView({ settings, methods, reasons }: { settings: PosSettings; methods: PaymentMethodRow[]; reasons: CashReasonRow[] }) {
  return (
    <div className={`${ui.page} max-w-4xl space-y-5`}>
      <h1 className={ui.h1}>Настройки</h1>
      <Rules settings={settings} />
      <Methods methods={methods} />
      <Reasons reasons={reasons} />
      <section className={`${ui.cardPad} text-sm leading-relaxed text-zinc-600`}>
        <h2 className={ui.h2}>Ещё</h2>
        <ul className="mt-2 space-y-1.5">
          <li>
            Кто подтверждает большие скидки своим PIN — в{" "}
            <Link href="/uchet/lyudi" className="font-semibold text-lavender-700 underline underline-offset-2">
              Сотрудниках
            </Link>
            , отметка «подтверждает скидки».
          </li>
          <li>
            Запуск учёта (из «Тренировки» в настоящий магазин) —{" "}
            <Link href="/uchet/sklad/settings" className="font-semibold text-lavender-700 underline underline-offset-2">
              Склад → Справочники
            </Link>
            .
          </li>
          <li>
            Когда считать выручку по Учёту, а не по Posiflora, — внизу{" "}
            <Link href="/uchet/svodka" className="font-semibold text-lavender-700 underline underline-offset-2">
              Сводки
            </Link>
            .
          </li>
        </ul>
      </section>
    </div>
  );
}

function Rules({ settings }: { settings: PosSettings }) {
  const [run, busy] = useRun();
  const [limit, setLimit] = useState(String(settings.discountLimitPercent));
  const [required, setRequired] = useState(settings.compositionRequired);
  const dirty = Number(limit.replace(",", ".")) !== settings.discountLimitPercent || required !== settings.compositionRequired;

  return (
    <section className={ui.cardPad}>
      <h2 className={ui.h2}>Касса</h2>
      <div className="mt-4 space-y-5">
        <div>
          <label className="flex flex-wrap items-center gap-2 text-[15px] text-zinc-900">
            Флорист даёт скидку сам до
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className={`${ui.fieldInline} w-20 text-center`} />%
            </span>
          </label>
          <p className="mt-1 text-sm text-zinc-500">Больше — касса попросит PIN того, кто подтверждает скидки.</p>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[15px] text-zinc-900">Продавать букет без состава («букет по цене»)</p>
            <p className="mt-1 text-sm text-zinc-500">
              Так сейчас продают «БУКЕТ 2000» в Posiflora. Если выключить, плитка «Букет по цене» из кассы пропадёт, и каждый букет придётся собирать
              из позиций — зато склад будет списываться точно.
            </p>
          </div>
          <Switch checked={!required} onChange={(v) => setRequired(!v)} label="Продавать букет без состава" />
        </div>
        <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          Бонусы клиентов ({settings.bonusPercent.toLocaleString("ru-RU")}%) пока ведёт Posiflora: касса Учёта их не начисляет и не списывает, чтобы
          баланс не жил в двух местах. Включим, когда перенесём балансы.
        </div>
        {dirty && (
          <button type="button" disabled={busy} onClick={() => run(() => savePosRules(Number(limit.replace(",", ".")), required), "Сохранено")} className={ui.btnPrimary}>
            {busy ? "…" : "Сохранить"}
          </button>
        )}
      </div>
    </section>
  );
}

function Methods({ methods }: { methods: PaymentMethodRow[] }) {
  const [run, busy] = useRun();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [isCash, setIsCash] = useState(false);

  function edit(m: PaymentMethodRow | null) {
    setEditing(m ? m.code : "new");
    setTitle(m?.title ?? "");
    setIsCash(m?.isCash ?? false);
  }

  async function save(m: PaymentMethodRow | null) {
    if (await run(() => savePaymentMethod({ code: m?.code ?? null, title, isCash, isActive: m?.isActive ?? true }), "Сохранено")) setEditing(null);
  }

  return (
    <section className={ui.cardPad}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={ui.h2}>Способы оплаты</h2>
        {editing !== "new" && (
          <button type="button" onClick={() => edit(null)} className={ui.btnSecondary}>
            + Способ
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-500">Что видит флорист в оплате. «Наличные» идут в пересчёт кассы смены, остальные — нет.</p>
      <ul className="mt-3 divide-y divide-zinc-100">
        {methods.map((m) => (
          <li key={m.code} className="py-3">
            {editing === m.code ? (
              <MethodForm title={title} setTitle={setTitle} isCash={isCash} setIsCash={setIsCash} cashLocked={m.used} busy={busy} onSave={() => save(m)} onCancel={() => setEditing(null)} />
            ) : (
              <div className={`flex items-center gap-3 ${m.isActive ? "" : "opacity-50"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-zinc-900">{m.title}</span>
                  <span className="block text-xs text-zinc-500">{m.isCash ? "наличные — в кассу смены" : "мимо кассы смены"}</span>
                </span>
                <button type="button" onClick={() => edit(m)} className="text-sm font-semibold text-lavender-700 underline underline-offset-2">
                  изменить
                </button>
                <Switch
                  checked={m.isActive}
                  disabled={busy}
                  label={`${m.title}: ${m.isActive ? "выключить" : "включить"}`}
                  onChange={(v) => run(() => savePaymentMethod({ code: m.code, title: m.title, isCash: m.isCash, isActive: v }), v ? "Включено" : "Выключено")}
                />
              </div>
            )}
          </li>
        ))}
        {editing === "new" && (
          <li className="py-3">
            <MethodForm title={title} setTitle={setTitle} isCash={isCash} setIsCash={setIsCash} cashLocked={false} busy={busy} onSave={() => save(null)} onCancel={() => setEditing(null)} />
          </li>
        )}
      </ul>
    </section>
  );
}

function MethodForm(p: { title: string; setTitle: (v: string) => void; isCash: boolean; setIsCash: (v: boolean) => void; cashLocked: boolean; busy: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="space-y-2 rounded-xl bg-zinc-50 p-3">
      <input value={p.title} onChange={(e) => p.setTitle(e.target.value)} placeholder="Например: Сертификат" maxLength={30} className={ui.fieldSm} autoFocus />
      <label className={`flex items-center gap-2 text-sm ${p.cashLocked ? "text-zinc-400" : "text-zinc-700"}`}>
        <input type="checkbox" checked={p.isCash} disabled={p.cashLocked} onChange={(e) => p.setIsCash(e.target.checked)} className="h-4 w-4 accent-lavender-600" />
        Это наличные — считать в кассе смены
      </label>
      {p.cashLocked && <p className="text-xs text-zinc-500">Этим способом уже платили — «наличные или нет» не меняется.</p>}
      <div className="flex gap-2">
        <button type="button" disabled={p.busy || !p.title.trim()} onClick={p.onSave} className={`${ui.btnPrimary} min-h-[38px] px-4`}>
          {p.busy ? "…" : "Сохранить"}
        </button>
        <button type="button" onClick={p.onCancel} className={`${ui.btnGhost} min-h-[38px]`}>
          Отмена
        </button>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<CashReasonKind, string> = {
  purchase: "закупка — откроет приход на склад",
  salary: "зарплата — спросит, кому выдано",
  collection: "инкассация",
  refund: "возврат клиенту — для отмены заказа",
  other: "",
};

function Reasons({ reasons }: { reasons: CashReasonRow[] }) {
  return (
    <section className={ui.cardPad}>
      <h2 className={ui.h2}>Причины внесения и изъятия наличных</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Кнопки, которые флорист выбирает в «Смене». Причины — общие («Закупка цветов»), а не «Эустома» или «Зарплата Даня»: что купили и кому
        выдали, касса спрашивает отдельно, и по таким причинам строится отчёт.
      </p>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <ReasonList direction="out" title="Изъятие" reasons={reasons.filter((r) => r.direction === "out")} />
        <ReasonList direction="in" title="Внесение" reasons={reasons.filter((r) => r.direction === "in")} />
      </div>
    </section>
  );
}

function ReasonList({ direction, title, reasons }: { direction: "in" | "out"; title: string; reasons: CashReasonRow[] }) {
  const [run, busy] = useRun();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("other");

  async function save(r: CashReasonRow | null) {
    if (await run(() => saveCashReason({ id: r?.id ?? null, direction, title: name, kind: r?.kind ?? kind, isActive: r?.isActive ?? true }), "Сохранено")) setEditing(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className={ui.label}>{title}</h3>
        {editing !== "new" && (
          <button
            type="button"
            onClick={() => {
              setEditing("new");
              setName("");
              setKind("other");
            }}
            className="text-sm font-semibold text-lavender-700 underline underline-offset-2"
          >
            + причина
          </button>
        )}
      </div>
      <ul className="mt-2 divide-y divide-zinc-100">
        {reasons.map((r) => (
          <li key={r.id} className="py-2.5">
            {editing === r.id ? (
              <ReasonForm name={name} setName={setName} busy={busy} onSave={() => save(r)} onCancel={() => setEditing(null)} />
            ) : (
              <div className={`flex items-center gap-3 ${r.isActive ? "" : "opacity-50"}`}>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(r.id);
                    setName(r.title);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block text-[15px] text-zinc-900">{r.title}</span>
                  {KIND_LABEL[r.kind] && <span className="block text-xs text-zinc-500">{KIND_LABEL[r.kind]}</span>}
                </button>
                <Switch
                  checked={r.isActive}
                  disabled={busy}
                  label={`${r.title}: ${r.isActive ? "выключить" : "включить"}`}
                  onChange={(v) => run(() => saveCashReason({ id: r.id, direction, title: r.title, kind: r.kind, isActive: v }), v ? "Включено" : "Выключено")}
                />
              </div>
            )}
          </li>
        ))}
        {editing === "new" && (
          <li className="py-2.5">
            <ReasonForm name={name} setName={setName} busy={busy} onSave={() => save(null)} onCancel={() => setEditing(null)}>
              {direction === "out" && (
                <select value={kind} onChange={(e) => setKind(e.target.value)} className={ui.fieldSm}>
                  <option value="other">Обычная — просто подпись</option>
                  <option value="purchase">Закупка — откроет приход на склад</option>
                  <option value="salary">Зарплата — спросит, кому выдано</option>
                </select>
              )}
            </ReasonForm>
          </li>
        )}
      </ul>
    </div>
  );
}

function ReasonForm({ name, setName, busy, onSave, onCancel, children }: { name: string; setName: (v: string) => void; busy: boolean; onSave: () => void; onCancel: () => void; children?: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl bg-zinc-50 p-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Упаковка" maxLength={40} className={ui.fieldSm} autoFocus />
      {children}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !name.trim()} onClick={onSave} className={`${ui.btnPrimary} min-h-[38px] px-4`}>
          {busy ? "…" : "Сохранить"}
        </button>
        <button type="button" onClick={onCancel} className={`${ui.btnGhost} min-h-[38px]`}>
          Отмена
        </button>
      </div>
    </div>
  );
}
