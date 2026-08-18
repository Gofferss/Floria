type BotanicalPatternProps = {
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Декоративный line-art орнамент из цветочных мотивов.
 * Используется как акцентный фоновый слой (Hero, Footer) — color наследуется
 * через currentColor, поэтому цвет задаётся снаружи классом text-*.
 */
export function BotanicalPattern({ className = "", style }: BotanicalPatternProps) {
  return (
    <svg
      viewBox="0 0 800 600"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        {/* Цветок 1 */}
        <g transform="translate(120 100)" opacity="0.55">
          <circle cx="0" cy="-15" r="13" />
          <circle cx="13" cy="7" r="13" />
          <circle cx="-13" cy="7" r="13" />
          <circle cx="0" cy="0" r="4" fill="currentColor" stroke="none" opacity="0.5" />
          <path d="M0 24C-6 55 8 85 -2 118" />
        </g>

        {/* Тюльпан */}
        <g transform="translate(660 80) scale(1.1)" opacity="0.45">
          <path d="M0 0c-2.5 1-3.5 3.4-2.2 6.2C-3.8 5.6-5.5 6.4-6 8.5c2 .6 3.6.1 4.7-1 .2 1.7 1 2.9 1.3 3.5.3-.6 1.1-1.8 1.3-3.5 1.1 1.1 2.7 1.6 4.7 1-.5-2.1-2.2-2.9-3.8-2.3C3.5 3.4 2.5 1 0 0z" />
          <path d="M0 11v50" />
        </g>

        {/* Ветка листьев */}
        <g transform="translate(60 380)" opacity="0.4">
          <path d="M0 0c30 10 55 35 60 70" />
          <path d="M10 12c8-4 18-3 24 4" />
          <path d="M28 34c8-4 18-3 24 4" />
          <path d="M44 55c6-3 14-2 19 3" />
        </g>

        {/* Цветок 2, крупный */}
        <g transform="translate(690 420) scale(1.3)" opacity="0.5">
          <circle cx="0" cy="-16" r="14" />
          <circle cx="14" cy="8" r="14" />
          <circle cx="-14" cy="8" r="14" />
          <circle cx="0" cy="18" r="14" />
          <circle cx="0" cy="4" r="5" fill="currentColor" stroke="none" opacity="0.5" />
        </g>

        {/* Одиночный стебель с бутоном */}
        <g transform="translate(380 520)" opacity="0.35">
          <path d="M0 60V0" />
          <circle cx="0" cy="-8" r="9" />
          <path d="M0 30c-10-4-16 2-18 10" />
          <path d="M0 42c10-4 16 2 18 10" />
        </g>
      </g>
    </svg>
  );
}
