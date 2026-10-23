import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canUseUchetWork } from "@/lib/auth/roles";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { getOpenShift, getPosSettings, listKassaAssortment, listPaymentMethods, listVitrine } from "@/lib/uchet/pos-queries";
import { listApprovers } from "@/lib/uchet/people";
import { getShopOrder } from "@/lib/uchet/order-queries";
import { Kassa } from "@/components/uchet/kassa/Kassa";

export const metadata: Metadata = {
  title: "Касса",
};

export const dynamic = "force-dynamic";

export default async function KassaPage({ searchParams }: { searchParams: Promise<{ mode?: string; vitrine?: string; order?: string }> }) {
  await requireStaffUser("/uchet/kassa", canUseUchetWork);
  const params = await searchParams;
  const location = await getDefaultLocation();

  // Сборка к заказу: только пока заказ не отдан. Что он того же места, проверит база.
  const order = params.mode === "assembly" && params.order && /^[0-9a-f-]{36}$/i.test(params.order) ? await getShopOrder(params.order) : null;
  const forOrder = order && ["new", "assembling", "ready"].includes(order.status) ? { id: order.id, number: order.number, wishes: order.wishes } : null;

  const [shift, assortment, vitrine, methods, settings, approvers] = await Promise.all([
    getOpenShift(location.id),
    listKassaAssortment(location.id, location.isTraining),
    // Себестоимость кассе не нужна — флорист её не видит.
    listVitrine(location.id, false),
    listPaymentMethods(),
    getPosSettings(),
    listApprovers(),
  ]);

  return (
    <Kassa
      mode={params.mode === "assembly" ? "assembly" : "sale"}
      addVitrineId={params.vitrine ?? null}
      forOrder={forOrder}
      shiftOpen={!!shift}
      items={assortment.items}
      groups={assortment.groups}
      frequent={assortment.frequent}
      vitrine={vitrine}
      methods={methods}
      settings={settings}
      isTraining={location.isTraining}
      approvers={approvers}
    />
  );
}
