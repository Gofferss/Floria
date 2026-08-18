type PhotoPlaceholderProps = {
  className?: string;
};

/**
 * Заглушка на месте ещё не загруженного фото (товар/статья/позиция в
 * корзине) — мягкая двухцветная растяжка без иконок и line-art: спокойный
 * нейтральный фон, который не спорит с реальными фото рядом в сетке.
 */
export function PhotoPlaceholder({ className = "" }: PhotoPlaceholderProps) {
  return (
    <div
      className={`bg-gradient-to-br from-lavender-100 via-lavender-50 to-gold-100/60 ${className}`}
      aria-hidden="true"
    />
  );
}
