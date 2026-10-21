"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { removeItemPhoto, uploadItemPhoto } from "@/lib/uchet/actions";
import { prepareImageForUpload } from "@/lib/prepare-image";
import { useToast } from "@/components/uchet/Toast";

/**
 * Фото позиции в шапке панели: касание — снять или выбрать новое. Нет фото
 * — на его месте «+ фото», чтобы было видно, чего не хватает.
 */
export function ItemPhoto({ itemId, photoUrl, title }: { itemId: string; photoUrl: string | null; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    const prepared = await prepareImageForUpload(file);
    if (!prepared.ok) {
      setBusy(false);
      return toast({ tone: "error", text: prepared.error });
    }
    const fd = new FormData();
    fd.set("file", prepared.file);
    const result = await uploadItemPhoto(itemId, fd);
    setBusy(false);
    if (input.current) input.current.value = "";
    if (!result.success) return toast({ tone: "error", text: result.error });
    toast({ tone: "ok", text: `Фото «${title}» обновлено` });
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const result = await removeItemPhoto(itemId);
    setBusy(false);
    if (!result.success) return toast({ tone: "error", text: result.error });
    router.refresh();
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        title={photoUrl ? "Сменить фото" : "Добавить фото"}
        className="relative h-16 w-16 overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-inset ring-zinc-200 transition hover:ring-lavender-400"
      >
        {photoUrl ? (
          <Image src={photoUrl} alt="" fill sizes="64px" className="object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-lavender-700">{busy ? "…" : "+ фото"}</span>
        )}
        {busy && photoUrl && <span className="absolute inset-0 flex items-center justify-center bg-white/60 text-xs font-semibold">…</span>}
      </button>
      {photoUrl && !busy && (
        <button type="button" onClick={remove} className="text-[11px] text-zinc-400 hover:text-red-600">
          убрать
        </button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}
