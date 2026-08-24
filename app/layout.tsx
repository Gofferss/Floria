import type { Metadata } from "next";
import { Montserrat, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartProvider } from "@/components/cart/CartProvider";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { LocalBusinessSchema } from "@/components/seo/LocalBusinessSchema";

const montserrat = Montserrat({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
  variable: "--font-montserrat",
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Floria — Студия цветов",
  description:
    "Floria — авторские букеты и цветочные подарки с доставкой. Искусство в каждом букете.",

  // Значки объявляем ЯВНО и файлами из /public, а не через app/icon.png.
  //
  // Причина — Яндекс.Вебмастер жаловался сразу на два: «файл favicon
  // недоступен для робота» и «добавьте SVG или 120×120». Next.js для
  // значков из папки app дописывает к адресу хэш вида /icon.png?d89bec13,
  // а робот Яндекса такой адрес не разбирает. Плюс /favicon.ico в корне,
  // куда он идёт в первую очередь, у нас просто не существовало — отсюда
  // «недоступен».
  //
  // Файлы из /public отдаются по чистому адресу без хэша, а порядок в
  // списке задаёт приоритет: сначала вектор (его Яндекс и просит), потом
  // 120×120, потом ico как запасной для старых читателей.
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-120.png", type: "image/png", sizes: "120x120" },
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${montserrat.variable} ${ibmPlexSans.variable}`}>
      <body className="bg-lavender-50 font-body text-ink antialiased">
        <LocalBusinessSchema />
        <CartProvider>
          <Header />
          <main>{children}</main>
          <Footer />
          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  );
}
