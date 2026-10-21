import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getPaymentOrder, PAID_STATUSES } from "@/lib/payments/vtb";
import { confirmPaidOrder } from "@/lib/payments/confirm";
import { CheckIcon, ClockIcon } from "@/components/ui/Icons";
import { CONTACTS } from "@/lib/contacts";

export const metadata: Metadata = {
  title: "Оплата заказа — Floria",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// ================================================================
// Куда банк возвращает человека после оплаты.
//
// Здесь мы НЕ верим факту возврата: на эту страницу можно прийти и не
// заплатив — закрыв форму, нажав «назад», просто открыв ссылку. Поэтому
// при каждом заходе спрашиваем у шлюза настоящий статус.
//
// Заодно это самый быстрый путь: уведомление от банка может задержаться
// на секунды, а человек уже смотрит в экран. Спросив сами, показываем
// правду сразу — и тем же вызовом подтверждаем заказ, если оплата прошла.
// ================================================================

export default async function PaymentReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabaseAdmin = getSupabaseAdmin();
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, total_amount, payment_status, customer_phone")
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  let paid = order.payment_status === "paid";

  if (!paid) {
    try {
      const state = await getPaymentOrder(order.order_number);
      if (PAID_STATUSES.has(state.status)) {
        await confirmPaidOrder(order.order_number, state.amount);
        paid = true;
      }
    } catch (error) {
      // Не смогли спросить банк — не беда: заказ останется в pending, а
      // сверка по расписанию доведёт дело до конца. Человеку про наши
      // внутренние сложности знать незачем, покажем «проверяем».
      console.error(`[payment-return] заказ ${order.order_number}:`, error);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center sm:px-6">
      <span
        className={`flex h-16 w-16 items-center justify-center rounded-full text-white ${
          paid ? "bg-gold-500" : "bg-lavender-300"
        }`}
      >
        {paid ? <CheckIcon className="h-7 w-7" /> : <ClockIcon className="h-7 w-7" />}
      </span>

      {paid ? (
        <>
          <h1 className="mt-6 font-display text-2xl font-bold text-ink sm:text-3xl">
            Оплачено, спасибо!
          </h1>
          <p className="mt-3 font-body text-base leading-relaxed text-ink/60">
            Заказ {order.order_number} на {order.total_amount} ₽ оплачен и передан флористу.
            Чек придёт на вашу почту. Мы свяжемся с вами, если понадобится что-то уточнить.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-6 font-display text-2xl font-bold text-ink sm:text-3xl">
            Проверяем оплату
          </h1>
          <p className="mt-3 font-body text-base leading-relaxed text-ink/60">
            Заказ {order.order_number} сохранён, но платёж пока не подтверждён. Иногда банку
            нужно до нескольких минут — обновите страницу чуть позже.
          </p>
          <p className="mt-3 font-body text-sm leading-relaxed text-ink/50">
            Если вы передумали или что-то пошло не так — позвоните нам:{" "}
            <a href={`tel:${CONTACTS.phoneHref}`} className="text-gold-700 hover:underline">
              {CONTACTS.phone}
            </a>
          </p>
        </>
      )}

      <Link
        href="/account"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-gold-500 px-8 py-4 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-gold-600"
      >
        Мои заказы
      </Link>
    </div>
  );
}
