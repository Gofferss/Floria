"use client";

// ================================================================
// Замена пустой абстрактной "капли" в блоке "О студии" (комментарий в
// коде так и говорил "заменить на фото студии" — фото ещё нет, а год
// пустоты хуже, чем осмысленная замена). Контур букета в той же
// line-art технике, что и BotanicalPattern, по умолчанию не закрашен —
// при наведении на всю карточку цвет "распускается" по бутонам с
// небольшим сдвигом по времени у каждого (лёгкое естественное
// ощущение, а не одновременный щелчок), плюс мягкое цветное свечение.
// Чистый CSS (group-hover), JS не нужен — только hover-состояние.
// ================================================================

type Bloom = {
  cx: number;
  cy: number;
  r: number;
  kind: "quad" | "tri";
  fill: string;
  center: string;
  glow: string;
  delay: number;
};

const BLOOMS: Bloom[] = [
  { cx: 240, cy: 150, r: 40, kind: "quad", fill: "url(#aboutLavender)", center: "url(#aboutGoldDot)", glow: "rgba(155,127,209,0.55)", delay: 0 },
  { cx: 150, cy: 210, r: 30, kind: "quad", fill: "url(#aboutBlush)", center: "url(#aboutGoldDot)", glow: "rgba(226,160,184,0.55)", delay: 90 },
  { cx: 330, cy: 205, r: 30, kind: "quad", fill: "url(#aboutGold)", center: "url(#aboutBlushDot)", glow: "rgba(217,181,49,0.5)", delay: 180 },
  { cx: 190, cy: 100, r: 18, kind: "tri", fill: "url(#aboutBlush)", center: "url(#aboutLavenderDot)", glow: "rgba(226,160,184,0.5)", delay: 270 },
  { cx: 300, cy: 95, r: 18, kind: "tri", fill: "url(#aboutLavender)", center: "url(#aboutGoldDot)", glow: "rgba(155,127,209,0.5)", delay: 340 },
];

function petalOffsets(r: number, kind: "quad" | "tri"): [number, number][] {
  return kind === "quad"
    ? [
        [0, -r],
        [r * 0.9, r * 0.45],
        [-r * 0.9, r * 0.45],
        [0, r * 0.85],
      ]
    : [
        [0, -r * 1.05],
        [r * 0.92, r * 0.5],
        [-r * 0.92, r * 0.5],
      ];
}

export function InteractiveBouquet() {
  return (
    <div className="group relative mx-auto aspect-square w-full max-w-md lg:max-w-none">
      <div
        className="absolute inset-0 bg-gradient-to-br from-lavender-100/70 via-lavender-50/50 to-white opacity-0 transition-opacity duration-700 group-hover:opacity-100"
        style={{ borderRadius: "42% 58% 63% 37% / 41% 44% 56% 59%" }}
        aria-hidden="true"
      />

      <svg viewBox="0 0 480 480" className="relative h-full w-full" role="img" aria-label="Букет Floria — наведите курсор, чтобы увидеть его в цвете">
        <defs>
          <radialGradient id="aboutLavender" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#EFE7FA" />
            <stop offset="100%" stopColor="#9B7FD1" />
          </radialGradient>
          <radialGradient id="aboutBlush" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#FBE4EC" />
            <stop offset="100%" stopColor="#E2A0B8" />
          </radialGradient>
          <radialGradient id="aboutGold" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#F9EDB0" />
            <stop offset="100%" stopColor="#D9B531" />
          </radialGradient>
          <radialGradient id="aboutGoldDot" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#F5D631" />
            <stop offset="100%" stopColor="#9C810D" />
          </radialGradient>
          <radialGradient id="aboutBlushDot" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#F6C9D8" />
            <stop offset="100%" stopColor="#C97B96" />
          </radialGradient>
          <radialGradient id="aboutLavenderDot" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#CDB2ED" />
            <stop offset="100%" stopColor="#7B5FB0" />
          </radialGradient>
        </defs>

        {/* Контур — виден всегда */}
        <g stroke="#7B5FB0" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.5">
          <path d="M240 300c-22 6-42 22-52 44" />
          <path d="M240 300c24 4 46 18 58 40" />
          {BLOOMS.map((b, i) => (
            <path key={i} d={`M${b.cx} ${b.cy + b.r * 0.4} Q${(b.cx + 240) / 2} ${(b.cy + 320) / 2} 240 320`} />
          ))}
        </g>
        <path
          d="M198 316 L282 316 L262 400 L218 400 Z"
          fill="none"
          stroke="#7B5FB0"
          strokeWidth="1.4"
          opacity="0.5"
        />
        {BLOOMS.map((b, i) => (
          <g key={i} stroke="#7B5FB0" strokeWidth="1.3" fill="none" opacity="0.55">
            {petalOffsets(b.r, b.kind).map(([dx, dy], j) => (
              <circle key={j} cx={b.cx + dx} cy={b.cy + dy} r={b.r} />
            ))}
            <circle cx={b.cx} cy={b.cy} r={b.r * 0.3} />
          </g>
        ))}

        {/* Цвет — распускается по наведении, у каждого бутона свой сдвиг */}
        {BLOOMS.map((b, i) => (
          <g
            key={i}
            className="opacity-0 transition-all duration-700 ease-out group-hover:opacity-100"
            style={{
              transitionDelay: `${b.delay}ms`,
              filter: "drop-shadow(0 0 0 rgba(0,0,0,0))",
            }}
          >
            <g className="transition-all duration-700 ease-out [filter:drop-shadow(0_0_0_rgba(0,0,0,0))] group-hover:[filter:drop-shadow(0_0_16px_var(--bloom-glow))]" style={{ ["--bloom-glow" as string]: b.glow }}>
              {petalOffsets(b.r, b.kind).map(([dx, dy], j) => (
                <circle
                  key={j}
                  cx={b.cx + dx}
                  cy={b.cy + dy}
                  r={b.r}
                  fill={b.fill}
                  stroke="white"
                  strokeOpacity="0.35"
                  strokeWidth="1"
                />
              ))}
              <circle cx={b.cx} cy={b.cy} r={b.r * 0.3} fill={b.center} />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}
