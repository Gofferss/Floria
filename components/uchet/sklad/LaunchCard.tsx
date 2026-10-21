"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setDefaultLocation } from "@/lib/uchet/actions";
import { ui } from "@/components/uchet/ui";

type Location = { id: string; title: string; isTraining: boolean; isDefault: boolean };

/**
 * Запуск учёта. Пока он не запущен, документы идут в «Тренировку». Запуск —
 * это переключение основного места на «Магазин», и с этой секунды каждый
 * приход и списание — настоящие. Поэтому перед кнопкой — короткий список
 * того, что должно быть сделано, а сама кнопка с подтверждением.
 */
export function LaunchCard({ locations }: { locations: Location[] }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = locations.find((l) => l.isDefault);
  const shop = locations.find((l) => !l.isTraining);
  const training = locations.find((l) => l.isTraining);
  const isTraining = !!current?.isTraining;
  const target = isTraining ? shop : training;

  async function switchTo() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const result = await setDefaultLocation(target.id);
    setBusy(false);
    setConfirm(false);
    if (!result.success) return setError(result.error);
    router.refresh();
  }

  return (
    <section className={`${ui.cardPad} ${isTraining ? "border-amber-200" : "border-emerald-200"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className={ui.h2}>Запуск учёта</h2>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
            isTraining ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {isTraining ? "тренировка" : "учёт запущен"}
        </span>
      </div>

      {isTraining ? (
        <>
          <p className={`${ui.muted} mt-2 max-w-2xl`}>
            Сейчас документы попадают в «Тренировку» и не влияют на настоящий учёт. Запускайте, когда будете готовы
            вести склад здесь, а не в Posiflora. Перед запуском:
          </p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-zinc-700">
            <li>Пересчитайте магазин — остатки Posiflora для этого не годятся: 60 позиций там в минусе.</li>
            <li>Сразу после запуска проведите пересчёт как «Начальный остаток» — с него начнётся журнал.</li>
            <li>С этого дня все приходы и списания — только здесь, иначе учёт разойдётся.</li>
          </ol>
        </>
      ) : (
        <p className={`${ui.muted} mt-2 max-w-2xl`}>
          Документы идут в «{current?.title}» — это настоящий учёт. Вернуться в тренировку можно, но уже проведённые
          настоящие документы останутся в журнале.
        </p>
      )}

      {target && (
        <div className="mt-5">
          {confirm ? (
            <div className={`rounded-xl p-4 ${isTraining ? "bg-amber-50" : "bg-zinc-50"}`}>
              <p className="text-sm text-zinc-800">
                {isTraining
                  ? "Запустить учёт? С этой секунды каждый приход и списание — настоящие."
                  : "Вернуться в тренировку? Новые документы снова пойдут в «Тренировку»."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={switchTo} className={ui.btnPrimary}>
                  {busy ? "Переключаем…" : isTraining ? "Да, запустить" : "Да, в тренировку"}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm(false)} className={ui.btnSecondary}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className={isTraining ? ui.btnPrimary : ui.btnSecondary}>
              {isTraining ? "Запустить учёт" : "Вернуться в тренировку"}
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}
