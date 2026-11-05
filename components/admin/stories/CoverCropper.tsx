"use client";

import { useEffect, useRef, useState } from "react";

// ================================================================
// Обрезка круглой обложки истории.
//
// Картинка двигается под круглой рамкой: пальцем или мышью, приближение —
// ползунком или двумя пальцами. Рядом тот же кадр размером с настоящий
// кружок на главной: в большой рамке читается то, что в маленьком круге
// уже не разобрать.
//
// На выходе квадратный JPEG. Круг на сайте и так рисует вёрстка, а квадрат
// можно потом подвинуть заново без потери качества.
// ================================================================

/** Сторона рамки на экране, px. */
const STAGE = 280;
/** Сторона готовой обложки: кружок на главной меньше 100 px, с запасом на чёткие экраны. */
const OUTPUT = 720;
const MAX_ZOOM = 4;
/** Кружок на главной — для предпросмотра рядом с рамкой. */
const PREVIEW = 76;

type View = { zoom: number; x: number; y: number };

/** Масштаб, при котором картинка ровно закрывает рамку по короткой стороне. */
function baseScale(w: number, h: number): number {
  return STAGE / Math.min(w, h);
}

/** Картинка не должна открывать пустоту внутри рамки. */
function clamp(view: View, w: number, h: number): View {
  const scale = baseScale(w, h) * view.zoom;
  return {
    zoom: view.zoom,
    x: Math.min(0, Math.max(STAGE - w * scale, view.x)),
    y: Math.min(0, Math.max(STAGE - h * scale, view.y)),
  };
}

/** Приближение вокруг центра рамки: то, что в центре, там и остаётся. */
function zoomTo(view: View, zoom: number, w: number, h: number): View {
  const next = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const ratio = next / view.zoom;
  return clamp(
    { zoom: next, x: STAGE / 2 - (STAGE / 2 - view.x) * ratio, y: STAGE / 2 - (STAGE / 2 - view.y) * ratio },
    w,
    h
  );
}

type CoverCropperProps = {
  src: string;
  busy?: boolean;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
};

export function CoverCropper({ src, busy = false, onCancel, onDone }: CoverCropperProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);

  // Активные пальцы (или мышь): один двигает, два приближают.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    setSize(null);
    setError(null);
    const img = new Image();
    // Без этого картинка из хранилища «испортит» canvas, и сохранить кадр браузер не даст.
    if (!src.startsWith("blob:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setSize({ w, h });
      const scale = baseScale(w, h);
      setView({ zoom: 1, x: (STAGE - w * scale) / 2, y: (STAGE - h * scale) / 2 });
    };
    img.onerror = () => setError("Не удалось открыть картинку — попробуйте другую");
    img.src = src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = null;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !size) return;
    const point = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, point);

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (!pinch.current) pinch.current = { dist, zoom: view.zoom };
      const zoom = pinch.current.zoom * (dist / pinch.current.dist);
      setView((v) => zoomTo(v, zoom, size.w, size.h));
      return;
    }
    setView((v) => clamp({ ...v, x: v.x + point.x - prev.x, y: v.y + point.y - prev.y }, size.w, size.h));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  }

  function handleDone() {
    const img = imgRef.current;
    if (!img || !size) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Этот браузер не умеет обрезать картинки — попробуйте другой");
      return;
    }
    const k = OUTPUT / STAGE;
    const scale = baseScale(size.w, size.h) * view.zoom;
    // Прозрачный PNG на JPEG дал бы чёрный фон.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, view.x * k, view.y * k, size.w * scale * k, size.h * scale * k);
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) onDone(blob);
          else setError("Не удалось сохранить кадр — попробуйте ещё раз");
        },
        "image/jpeg",
        0.9
      );
    } catch {
      setError("Браузер не дал сохранить этот кадр — загрузите картинку с устройства");
    }
  }

  const scale = size ? baseScale(size.w, size.h) * view.zoom : 1;
  const picture = (k: number) =>
    size && (
      <img
        src={src}
        alt=""
        draggable={false}
        className="absolute left-0 top-0 max-w-none select-none"
        style={{
          width: size.w * scale * k,
          height: size.h * scale * k,
          transform: `translate(${view.x * k}px, ${view.y * k}px)`,
        }}
      />
    );

  return (
    <div className="rounded-2xl border border-lavender-200 bg-lavender-50 p-4">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div
          className="relative shrink-0 cursor-grab touch-none overflow-hidden rounded-xl bg-ink/10 active:cursor-grabbing"
          style={{ width: STAGE, height: STAGE }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {picture(1)}
          {/* Круглая рамка: всё за её краем затемнено, в кружок это не попадёт. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white"
            style={{ boxShadow: "0 0 0 200px rgb(0 0 0 / 0.45)" }}
          />
          {!size && !error && (
            <span className="absolute inset-0 flex items-center justify-center font-body text-xs text-ink/50">
              Открываем картинку…
            </span>
          )}
        </div>

        <div className="flex w-full min-w-0 flex-col gap-4">
          <div>
            <span className="block font-body text-xs text-ink/50">Так будет на главной</span>
            <div className="relative mt-2 overflow-hidden rounded-full bg-ink/10" style={{ width: PREVIEW, height: PREVIEW }}>
              {picture(PREVIEW / STAGE)}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-ink/50">Приближение</span>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={view.zoom}
              disabled={!size}
              onChange={(e) => size && setView((v) => zoomTo(v, Number(e.target.value), size.w, size.h))}
              className="w-full accent-gold-500"
            />
          </label>
          <p className="font-body text-xs text-ink/50">Двигайте картинку пальцем или мышью, чтобы главное оказалось в круге.</p>

          {error && <p className="font-body text-xs text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDone}
              disabled={!size || busy}
              className="rounded-full bg-gold-500 px-5 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Сохраняем…" : "Готово"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-full border border-lavender-200 bg-white px-5 py-2.5 font-display text-sm font-medium text-ink/70 transition hover:border-gold-300 disabled:opacity-60"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
