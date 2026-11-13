import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { onlinePaymentEnabled } from "@/lib/payments/online";

export const metadata: Metadata = {
  title: "Оформление заказа — Floria",
  description: "Оформите доставку букета от студии Floria в Симферополе.",
};

// Включена ли онлайн-оплата, решают ключи банка в окружении сервера, а не
// сборка: страница считается на каждый заход.
export const dynamic = "force-dynamic";

export default function CheckoutPage() {
  return <CheckoutView onlinePayment={onlinePaymentEnabled()} />;
}
