type BloomMarkProps = {
  className?: string;
};

/**
 * Единственный сдержанный цветочный штрих для пустых состояний (пустая
 * корзина, нет заказов, нет статей) — один бутон на стебле, а не "сцена"
 * из нескольких цветов, как раньше рисовал BotanicalPattern. Цвет — через
 * currentColor, класс text-* задаётся снаружи.
 */
export function BloomMark({ className = "" }: BloomMarkProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 33c-4 9-2 17 2 25" />
        <path d="M30 44c-6-2-10 2-11 7" />
        <path d="M34 50c6-2 10 2 11 7" />
        <circle cx="32" cy="21" r="10" />
        <circle cx="32" cy="21" r="3" fill="currentColor" stroke="none" opacity="0.55" />
      </g>
    </svg>
  );
}
