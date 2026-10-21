import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartProvider } from "@/components/cart/CartProvider";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { LocalBusinessSchema } from "@/components/seo/LocalBusinessSchema";

/**
 * Обвязка магазина: шапка, подвал, корзина, разметка для поисковиков.
 *
 * Раньше она стояла в корневом шаблоне и оборачивала вообще всё, включая
 * рабочее приложение учёта, — флорист видел над складом меню магазина и
 * корзину. Теперь она только у страниц сайта; учёт (/uchet) живёт в своей
 * группе со своим каркасом. Адреса страниц от группы не меняются.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LocalBusinessSchema />
      <CartProvider>
        <Header />
        <main>{children}</main>
        <Footer />
        <CartDrawer />
      </CartProvider>
    </>
  );
}
