import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Нежно-фиолетовый (лаванда) — фон и мягкие акценты
        lavender: {
          50: "#F7F4FC",
          100: "#EFE7FA",
          200: "#DFCEF4",
          300: "#CDB2ED",
          500: "#9B7FD1",
          600: "#7B5FB0", // насыщенный фиолетовый — акцентные кнопки (как на макете)
          700: "#5E4A96",
        },
        // Глубокий сливовый — только для подвала, для контраста с золотом
        plum: {
          900: "#241832",
          950: "#180F22",
        },
        // Золото — под цвет логотипа (F5D631). 400 — точный цвет логотипа,
        // используется там, где не нужен контраст с текстом поверх (иконки,
        // бордеры, hover на тёмном фоне подвала). 500/600/700 чуть темнее —
        // это фон кнопок с белым текстом поверх, у чистого F5D631 контраст
        // с белым ~1.4:1 (нечитаемо), поэтому кнопки остаются насыщенным,
        // но не самым светлым тоном той же гаммы.
        gold: {
          300: "#F5E7A3",
          400: "#F5D631", // точный цвет логотипа
          500: "#BA9B12",
          600: "#9C810D",
          700: "#6F5D0B",
        },
        // Текст
        ink: "#1C1A22",
      },
      fontFamily: {
        display: ["var(--font-montserrat)", "sans-serif"],
        body: ["var(--font-ibm-plex-sans)", "sans-serif"],
      },
      borderRadius: {
        "4xl": "2rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-14px)" },
        },
        // Медленное "дыхание" — сдвиг + масштаб, для крупных фоновых пятен
        // (HeroBackdrop), а не для мелких декоративных иконок (те на float).
        blob: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(4%, -6%) scale(1.08)" },
          "66%": { transform: "translate(-3%, 4%) scale(0.95)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.7s ease-out both",
        // Общий keyframe, но разная длительность — создаёт эффект "разной
        // скорости покачивания" без дублирования кода анимации
        "float-slow": "float 7s ease-in-out infinite",
        "float-fast": "float 5s ease-in-out infinite",
        blob: "blob 16s ease-in-out infinite",
        "blob-reverse": "blob 22s ease-in-out infinite reverse",
      },
      typography: {
        // Дефолтная тема .prose — серо-синяя, "ничья". Переопределяем на
        // наши токены, чтобы текст статьи блога читался как часть Floria,
        // а не как generic markdown-рендер.
        DEFAULT: {
          css: {
            "--tw-prose-body": "rgb(28 26 34 / 0.8)", // text-ink/80
            "--tw-prose-headings": "#1C1A22", // ink
            "--tw-prose-lead": "rgb(28 26 34 / 0.7)",
            "--tw-prose-links": "#A8813A", // gold-600
            "--tw-prose-bold": "#1C1A22",
            "--tw-prose-bullets": "#C9A24B", // gold-500
            "--tw-prose-quotes": "#1C1A22",
            "--tw-prose-quote-borders": "#D4B15E", // gold-400
            "--tw-prose-hr": "#EFE7FA", // lavender-100
            maxWidth: "68ch",
            fontFamily: "var(--font-ibm-plex-sans)",
            h1: { fontFamily: "var(--font-montserrat)", fontWeight: "700" },
            h2: { fontFamily: "var(--font-montserrat)", fontWeight: "600" },
            h3: { fontFamily: "var(--font-montserrat)", fontWeight: "600" },
            h4: { fontFamily: "var(--font-montserrat)", fontWeight: "600" },
            a: { fontWeight: "500", textDecoration: "none" },
            "a:hover": { color: "#8A6B2E" }, // gold-700
            blockquote: { fontStyle: "normal", fontFamily: "var(--font-montserrat)" },
          },
        },
      },
    },
  },
  plugins: [typography],
};

export default config;
