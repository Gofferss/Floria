"use client";

import { useEffect, useState } from "react";
import type { SaleInput } from "@/lib/uchet/pos-actions";

// ================================================================
// Продажи, не дошедшие до сервера: связь пропала в момент оплаты.
//
// Лежат на айпаде (localStorage) и досылаются сами, когда связь вернётся
// (OutboxStatus в шапке учёта). Сервер проводит чек по его идентификатору
// один раз (pos_record_sale): дослать дважды не страшно — второй раз
// вернётся тот же чек. Поэтому, если ответ потерялся по дороге, а чек на
// самом деле прошёл, повторная отправка ничего не задвоит.
//
// Чего это НЕ умеет: открыть учёт с нуля без связи (страница должна быть
// уже открыта) и провести без связи что-то кроме продажи.
// ================================================================

export type Pending = {
  id: string;
  input: SaleInput;
  amount: number;
  savedAt: number;
  /** Ответ сервера, если он отказал по делу (не связь). Такие сами не досылаются. */
  error: string | null;
};

const STORE = "uchet.outbox.v1";
const EVENT = "uchet-outbox";

export function readOutbox(): Pending[] {
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw ? (JSON.parse(raw) as Pending[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && p.input) : [];
  } catch {
    return [];
  }
}

function write(list: Pending[]) {
  try {
    if (list.length) localStorage.setItem(STORE, JSON.stringify(list));
    else localStorage.removeItem(STORE);
  } catch {
    // Хранилище переполнено или запрещено — продажа не сохранится, и это
    // надо видеть: событие всё равно уйдёт, а касса покажет ошибку.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function enqueueSale(p: Omit<Pending, "error">): boolean {
  const list = readOutbox().filter((x) => x.id !== p.id);
  write([...list, { ...p, error: null }]);
  return readOutbox().some((x) => x.id === p.id);
}

export function removePending(id: string) {
  write(readOutbox().filter((p) => p.id !== id));
}

export function setPendingError(id: string, error: string | null) {
  write(readOutbox().map((p) => (p.id === id ? { ...p, error } : p)));
}

/** Букеты витрины из неотправленных чеков — их нельзя продать второй раз. */
export function pendingVitrineIds(list: Pending[]): Set<string> {
  const ids = new Set<string>();
  for (const p of list) for (const l of p.input.lines) if (l.kind === "vitrine") ids.add(l.bouquetId);
  return ids;
}

/**
 * Серверное действие из старой версии страницы: после выкладки новой
 * версии открытый айпад зовёт действие, которого на сервере уже нет.
 * Лечится только перезагрузкой — чек и очередь при этом сохраняются.
 */
export function isStaleAction(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /server action/i.test(msg) && /not found|failed to find/i.test(msg);
}

/**
 * Почему вызов сервера не вернул ответ:
 *   * network — связи нет или сервер недоступен: досылаем сами;
 *   * stale   — открыта старая версия страницы: нужна перезагрузка;
 *   * server  — сервер ответил ошибкой (например, истёк вход): сами не
 *               повторяем, показываем «не прошло».
 * Обрыв связи браузер отдаёт как TypeError («Failed to fetch», в Safari —
 * «Load failed»); недоступный сервер за прокси — как «unexpected response».
 */
export function classifyFailure(e: unknown): "network" | "stale" | "server" {
  if (isStaleAction(e)) return "stale";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "network";
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof TypeError || /failed to fetch|load failed|networkerror|network request|unexpected response/i.test(msg)) return "network";
  return "server";
}

export const SERVER_FAILURE = "сервер ответил ошибкой — возможно, истёк вход. Обновите страницу, при необходимости войдите заново и нажмите «Повторить».";

export function useOutbox(): Pending[] {
  const [list, setList] = useState<Pending[]>([]);
  useEffect(() => {
    const update = () => setList(readOutbox());
    update();
    window.addEventListener(EVENT, update);
    // Другая вкладка на том же айпаде.
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return list;
}
