import { isVtbSandbox } from "@/lib/payments/vtb";

/**
 * Принимает ли сайт оплату онлайн.
 *
 * Только с боевыми ключами ВТБ. В песочнице «оплата» проходит без денег, и
 * покупатель мог решить, что заплатил (14.11.2026 владелец: «пока по звонку
 * или в Telegram»). Поэтому, пока VTB_API_BASE не боевой, заказ оформляется
 * без оплаты: студия звонит или пишет и договаривается. Как только владелец
 * впишет боевые ключи и перезапустит сайт — оплата включится сама.
 * ONLINE_PAYMENT=off выключает её и с боевыми ключами (на случай сбоя банка).
 */
export function onlinePaymentEnabled(): boolean {
  if (process.env.ONLINE_PAYMENT === "off") return false;
  return Boolean(process.env.VTB_API_BASE) && !isVtbSandbox();
}
