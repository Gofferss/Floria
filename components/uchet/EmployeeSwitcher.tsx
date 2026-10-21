"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { leaveEmployee, switchEmployee } from "@/lib/uchet/people-actions";
import type { PickableEmployee } from "@/lib/uchet/people";
import { CloseButton, Dialog } from "@/components/uchet/Overlay";
import { NumPad, PinDots } from "@/components/uchet/NumPad";

type Props = {
  employees: PickableEmployee[];
  currentId: string | null;
  /** Общий планшет без выбранного человека: закрыть окно нельзя. */
  mandatory: boolean;
  onClose: () => void;
};

/**
 * «Кто работает». Два касания и четыре цифры — без SMS и паролей.
 * Смена флориста посреди дня — то же самое: нажать на имя вверху.
 */
export function EmployeeSwitcher({ employees, currentId, mandatory, onClose }: Props) {
  const router = useRouter();
  const [picked, setPicked] = useState<string | null>(employees.length === 1 ? employees[0].id : null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pin.length !== 4 || !picked || busy) return;
    let cancelled = false;
    setBusy(true);
    switchEmployee(picked, pin).then((result) => {
      if (cancelled) return;
      setBusy(false);
      setPin("");
      if (!result.success) return setError(result.error);
      onClose();
      router.refresh();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, picked]);

  async function leave() {
    setBusy(true);
    await leaveEmployee();
    setBusy(false);
    onClose();
    router.refresh();
  }

  const person = employees.find((e) => e.id === picked);

  return (
    <Dialog label="Кто работает" onClose={onClose} dismissible={!mandatory}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-zinc-900">Кто работает?</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Каждая продажа и списание будут подписаны этим именем.</p>
        </div>
        {!mandatory && <CloseButton onClose={onClose} />}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {employees.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => {
              setPicked(e.id);
              setPin("");
              setError(null);
            }}
            aria-pressed={picked === e.id}
            className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-sm font-semibold transition ${
              picked === e.id ? "bg-lavender-50 text-zinc-900 ring-2 ring-lavender-600" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-lavender-600 font-display text-base text-white">
              {e.shortName.slice(0, 1).toUpperCase()}
            </span>
            <span className="max-w-full truncate">{e.shortName}</span>
          </button>
        ))}
      </div>

      {person ? (
        <div className="mt-5">
          <p className="mb-3 text-center text-sm text-zinc-600">PIN для «{person.shortName}»</p>
          <PinDots length={4} filled={pin.length} />
          <p className="mt-2 min-h-[1.25rem] text-center text-sm text-red-600" role="alert">
            {busy ? <span className="text-zinc-500">Проверяем…</span> : error}
          </p>
          <div className="mt-2">
            <NumPad value={pin} onChange={(v) => !busy && setPin(v)} maxLength={4} pin />
          </div>
        </div>
      ) : (
        <p className="mt-5 text-center text-sm text-zinc-500">Выберите себя</p>
      )}

      {currentId && (
        <button type="button" onClick={leave} disabled={busy} className="mt-4 w-full rounded-xl py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800">
          Закончить работу — никто не выбран
        </button>
      )}
    </Dialog>
  );
}
