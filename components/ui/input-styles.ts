export function inputClass(hasError?: boolean): string {
  return [
    "w-full rounded-xl border bg-lavender-50 px-4 py-3 font-body text-sm text-ink placeholder:text-ink/40 outline-none transition focus:bg-white",
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
      : "border-lavender-200 focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20",
  ].join(" ");
}
