type AmbientGlowProps = {
  className?: string;
};

/**
 * Фоновая "живая" подложка для крупных блоков (шапки инфостраниц, пустые
 * секции) — два мягких дышащих цветовых пятна на blur, тот же приём и те
 * же keyframes (blob/blob-reverse, tailwind.config.ts), что и в Hero.
 * Сознательно без line-art: пользователь просил убрать "просто svg
 * кружочками" рисунки везде, где раньше стоял BotanicalPattern фоном.
 * Серверный компонент — анимация чисто на CSS, JS не нужен.
 */
export function AmbientGlow({ className = "" }: AmbientGlowProps) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <div className="absolute -left-1/4 -top-1/3 h-[70%] w-[70%] rounded-full bg-gold-300/25 blur-3xl motion-safe:animate-blob" />
      <div className="absolute -right-1/4 -bottom-1/3 h-[75%] w-[75%] rounded-full bg-lavender-300/35 blur-3xl motion-safe:animate-blob-reverse" />
    </div>
  );
}
