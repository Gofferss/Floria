"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAccount, resetAccountPassword, saveEmployee, updateAccount } from "@/lib/uchet/people-actions";
import type { AccountRow, EmployeeRow } from "@/lib/uchet/people";
import { POSITIONS, POSITION_LABEL, type Position } from "@/lib/uchet/positions";
import { ROLE_HINT, ROLE_LABEL, STAFF_ROLES, type StaffRole } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/uchet/format";
import { ui } from "@/components/uchet/ui";
import { useToast } from "@/components/uchet/Toast";
import { CloseButton, Panel } from "@/components/uchet/Overlay";

// ================================================================
// Сотрудники. Две разные вещи на одном экране — и подсказка, чем они
// отличаются, прямо здесь, а не в инструкции:
//   * люди — кто работает за планшетом и подписывает действия PIN;
//   * входы — учётные записи с почтой и паролем.
// ================================================================

// Роль «admin» — та же, что owner: так заведена первая учётная запись.
// Новым входам её не предлагаем, чтобы не было двух одинаковых пунктов.
const ROLE_CHOICES: StaffRole[] = STAFF_ROLES.filter((r) => r !== "admin");

export function PeopleView({ employees, accounts, meId }: { employees: EmployeeRow[]; accounts: AccountRow[]; meId: string }) {
  const [editEmployee, setEditEmployee] = useState<EmployeeRow | "new" | null>(null);
  const [editAccount, setEditAccount] = useState<AccountRow | "new" | null>(null);

  return (
    <div className={`${ui.page} max-w-5xl space-y-6`}>
      <section className={ui.cardPad}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className={ui.h1}>Люди в магазине</h1>
            <p className={`${ui.muted} mt-1 max-w-2xl`}>
              Кто работает за айпадом магазина. Каждый выбирает себя и вводит свой PIN из 4 цифр — так каждая продажа и
              списание подписаны именем. Отсюда же потом будут считаться проценты и ставки.
            </p>
          </div>
          <button type="button" onClick={() => setEditEmployee("new")} className={ui.btnPrimary}>
            + Человек
          </button>
        </div>

        {employees.length === 0 ? (
          <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Пока никого. Заведите флористов — и айпад магазина начнёт спрашивать «кто работает?».
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-zinc-100">
            {employees.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setEditEmployee(e)} className={`flex w-full items-center gap-3 py-3 text-left ${e.isActive ? "" : "opacity-50"}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lavender-600 font-display text-white">
                    {e.shortName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-zinc-900">
                      {e.fullName}
                      {e.shortName !== e.fullName && <span className="font-normal text-zinc-500"> · «{e.shortName}»</span>}
                    </span>
                    <span className="block text-sm text-zinc-500">
                      {POSITION_LABEL[e.position]}
                      {e.canApprove && " · подтверждает скидки"}
                      {e.staffId && " · свой вход"}
                      {!e.isActive && " · не работает"}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${e.hasPin ? "bg-emerald-50 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                    {e.hasPin ? "PIN задан" : "нет PIN"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={ui.cardPad}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={ui.h1}>Входы</h2>
            <p className={`${ui.muted} mt-1 max-w-2xl`}>
              Почта и пароль, с которыми входят в учёт. У владельцев — личные, у айпада магазина — один общий с ролью
              «Магазин / флорист», у курьера — свой. Роль решает, что открыто.
            </p>
          </div>
          <button type="button" onClick={() => setEditAccount("new")} className={ui.btnSecondary}>
            + Вход
          </button>
        </div>
        <ul className="mt-5 divide-y divide-zinc-100">
          {accounts.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setEditAccount(a)} className={`flex w-full items-center gap-3 py-3 text-left ${a.isActive ? "" : "opacity-50"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-zinc-900">
                    {a.fullName}
                    {a.id === meId && <span className="font-normal text-zinc-500"> · это вы</span>}
                  </span>
                  <span className="block text-sm text-zinc-500">
                    {a.email ?? "почта не указана"} · последний вход {a.lastSignInAt ? formatDateTime(a.lastSignInAt) : "не было"}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                  {ROLE_LABEL[a.role as StaffRole] ?? a.role}
                  {!a.isActive && " · выключен"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {editEmployee && (
        <EmployeeEditor employee={editEmployee === "new" ? null : editEmployee} accounts={accounts} onClose={() => setEditEmployee(null)} />
      )}
      {editAccount && <AccountEditor account={editAccount === "new" ? null : editAccount} isMe={editAccount !== "new" && editAccount.id === meId} onClose={() => setEditAccount(null)} />}
    </div>
  );
}

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 accent-lavender-600" />
      <span>
        <span className="block text-sm font-medium text-zinc-900">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}

function EmployeeEditor({ employee, accounts, onClose }: { employee: EmployeeRow | null; accounts: AccountRow[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [fullName, setFullName] = useState(employee?.fullName ?? "");
  const [shortName, setShortName] = useState(employee?.shortName ?? "");
  const [position, setPosition] = useState<Position>(employee?.position ?? "florist");
  const [canApprove, setCanApprove] = useState(employee?.canApprove ?? false);
  const [staffId, setStaffId] = useState(employee?.staffId ?? "");
  const [isActive, setIsActive] = useState(employee?.isActive ?? true);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await saveEmployee({ id: employee?.id, fullName, shortName, position, canApprove, staffId: staffId || null, isActive, pin });
    setBusy(false);
    if (!result.success) return setError(result.error);
    toast({ tone: "ok", text: employee ? "Сохранено" : `${shortName || fullName} заведён(а)` });
    onClose();
    router.refresh();
  }

  return (
    <Panel label={employee ? employee.fullName : "Новый человек"} onClose={onClose}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5">
        <h2 className="font-display text-lg font-semibold">{employee ? employee.fullName : "Новый человек"}</h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className="space-y-4 p-5">
        <div>
          <label htmlFor="emp-full" className={ui.label}>
            Имя и фамилия
          </label>
          <input id="emp-full" value={fullName} onChange={(e) => setFullName(e.target.value)} className={`${ui.field} mt-1`} placeholder="Татьяна Иванова" />
        </div>
        <div>
          <label htmlFor="emp-short" className={ui.label}>
            Как показывать на кнопке
          </label>
          <input id="emp-short" value={shortName} onChange={(e) => setShortName(e.target.value)} className={`${ui.field} mt-1`} placeholder="Таня" />
        </div>
        <div>
          <p className={ui.label}>Должность</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {POSITIONS.map((p) => (
              <button key={p} type="button" onClick={() => setPosition(p)} aria-pressed={position === p} className={`${ui.chip} ${position === p ? ui.chipOn : ui.chipOff}`}>
                {POSITION_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="emp-pin" className={ui.label}>
            {employee?.hasPin ? "Новый PIN — если меняете" : "PIN из 4 цифр"}
          </label>
          <input
            id="emp-pin"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="off"
            className={`${ui.field} mt-1 w-40 text-center font-display text-xl tracking-[0.5em]`}
            placeholder="••••"
          />
          <p className="mt-1 text-xs text-zinc-500">Скажите человеку PIN лично. Простые вроде 1234 и 0000 не подойдут.</p>
        </div>
        <Toggle
          id="emp-approve"
          checked={canApprove}
          onChange={setCanApprove}
          label="Подтверждает скидки"
          hint="Скидку больше лимита флорист даёт только с PIN такого человека"
        />
        <div>
          <label htmlFor="emp-staff" className={ui.label}>
            Свой вход
          </label>
          <select id="emp-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)} className={`${ui.field} mt-1`}>
            <option value="">Нет — работает за общим айпадом</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName} ({ROLE_LABEL[a.role as StaffRole] ?? a.role})
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">Если у человека личный вход (владелец), на своём устройстве PIN ему не нужен.</p>
        </div>
        <Toggle id="emp-active" checked={isActive} onChange={setIsActive} label="Работает" hint="Выключенный пропадает из выбора, а в истории остаётся" />
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <button type="button" disabled={busy} onClick={submit} className={`${ui.btnPrimary} min-h-[52px] w-full`}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </Panel>
  );
}

function AccountEditor({ account, isMe, onClose }: { account: AccountRow | null; isMe: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [fullName, setFullName] = useState(account?.fullName ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>((account?.role as StaffRole) ?? "florist");
  const [isActive, setIsActive] = useState(account?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    if (!account) {
      const r = await createAccount({ fullName, email, password, role });
      setBusy(false);
      if (!r.success) return setError(r.error);
      toast({ tone: "ok", text: "Вход создан. Передайте почту и пароль лично" });
    } else {
      const r = await updateAccount({ id: account.id, fullName, role, isActive });
      if (!r.success) {
        setBusy(false);
        return setError(r.error);
      }
      if (password) {
        const p = await resetAccountPassword(account.id, password);
        if (!p.success) {
          setBusy(false);
          return setError(p.error);
        }
      }
      setBusy(false);
      toast({ tone: "ok", text: password ? "Сохранено, пароль сменён" : "Сохранено" });
    }
    onClose();
    router.refresh();
  }

  const roles = account?.role === "admin" ? (["admin", ...ROLE_CHOICES] as StaffRole[]) : ROLE_CHOICES;

  return (
    <Panel label={account ? account.fullName : "Новый вход"} onClose={onClose}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold">{account ? account.fullName : "Новый вход"}</h2>
          {account?.email && <p className="mt-0.5 text-sm text-zinc-500">{account.email}</p>}
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="space-y-4 p-5">
        <div>
          <label htmlFor="acc-name" className={ui.label}>
            Чей это вход
          </label>
          <input id="acc-name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={`${ui.field} mt-1`} placeholder="Магазин · Киевская" />
        </div>
        {!account && (
          <div>
            <label htmlFor="acc-email" className={ui.label}>
              Почта
            </label>
            <input id="acc-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={`${ui.field} mt-1`} placeholder="shop@floria-simferopol.ru" />
            <p className="mt-1 text-xs text-zinc-500">Письма на неё не приходят — это просто логин. Можно любую свою.</p>
          </div>
        )}
        <div>
          <label htmlFor="acc-pass" className={ui.label}>
            {account ? "Новый пароль — если меняете" : "Пароль"}
          </label>
          <input id="acc-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${ui.field} mt-1`} />
          <p className="mt-1 text-xs text-zinc-500">Не короче 8 символов, буквы и цифры.</p>
        </div>
        <div>
          <p className={ui.label}>Роль</p>
          <div className="mt-2 space-y-2">
            {roles.map((r) => (
              <label key={r} className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-inset ${role === r ? "bg-lavender-50 ring-lavender-400" : "ring-zinc-200"}`}>
                <input type="radio" name="acc-role" value={r} checked={role === r} onChange={() => setRole(r)} disabled={isMe} className="mt-1 h-4 w-4 accent-lavender-600" />
                <span>
                  <span className="block text-sm font-semibold">{ROLE_LABEL[r]}</span>
                  <span className="block text-xs text-zinc-500">{ROLE_HINT[r]}</span>
                </span>
              </label>
            ))}
          </div>
          {isMe && <p className="mt-2 text-xs text-zinc-500">Свою роль не поменять — чтобы случайно не остаться без прав владельца.</p>}
        </div>
        {account && !isMe && <Toggle id="acc-active" checked={isActive} onChange={setIsActive} label="Вход действует" hint="Выключенный больше не откроет ни учёт, ни админку" />}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <button type="button" disabled={busy} onClick={submit} className={`${ui.btnPrimary} min-h-[52px] w-full`}>
          {busy ? "Сохраняем…" : account ? "Сохранить" : "Создать вход"}
        </button>
      </div>
    </Panel>
  );
}
