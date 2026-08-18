import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/CheckoutView";

export const metadata: Metadata = {
  title: "Оформление заказа — Floria",
  description: "Оформите доставку букета от студии Floria в Симферополе.",
};

export default function CheckoutPage() {
  return <CheckoutView />;
}
