"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { notifyCustomerAboutStatus, sendAssembledPhotoToCustomer } from "@/lib/telegram/order-notify";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Управление статусом заказа из /admin/orders. Заказы с сайта пока не
// попадают в Posiflora по-настоящему (см. lib/posiflora/orders.ts —
// заглушка), а их публичный API вообще не даёт привязать состав к
// заказу — статус пришлось бы отслеживать там вручную и негде. Поэтому
// статус — целиком наш: сотрудник меняет его здесь, клиент видит
// изменение в /account (components/account/OrderHistoryList.tsx читает
// orders.status напрямую, без дополнительных правок).
// ================================================================

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

export type OrderStatus =
  | "new"
  | "confirmed"
  | "assembling"
  | "ready"
  | "delivering"
  | "completed"
  | "cancelled";

type ActionResult = { success: true } | { success: false; error: string };

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<ActionResult> {
  const staff = await requireStaff();

  const { error } = await getSupabaseAdmin().from("orders").update({ status }).eq("id", orderId);
  if (error) {
    console.error("[updateOrderStatus]", error.message);
    return { success: false, error: "Не удалось обновить статус" };
  }

  const { error: historyError } = await getSupabaseAdmin()
    .from("order_status_history")
    .insert({ order_id: orderId, status, changed_by: staff.id });
  if (historyError) console.error("[updateOrderStatus] history", historyError.message);

  // Клиенту в бот — если он его подключил. Внутри функция сама решает, о
  // каких статусах писать стоит: «новый» он только что видел на экране, а
  // «готов» и «отменён» требуют разговора, а не автосообщения.
  // Сбой отправки статус не откатывает: он уже сохранён.
  await notifyCustomerAboutStatus(orderId, status);

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { success: true };
}

/**
 * Отдельная от статуса отметка «флорист увидел и взял в работу» — быстрый
 * чек-бокс в списке заказов, не требует открывать карточку и выбирать
 * стадию. accepted=false очищает отметку (снять галочку по ошибке).
 */
export async function setOrderFloristAccepted(orderId: string, accepted: boolean): Promise<ActionResult> {
  await requireStaff();

  const { error } = await getSupabaseAdmin()
    .from("orders")
    .update({ florist_accepted_at: accepted ? new Date().toISOString() : null })
    .eq("id", orderId);

  if (error) {
    console.error("[setOrderFloristAccepted]", error.message);
    return { success: false, error: "Не удалось сохранить отметку" };
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { success: true };
}

// ================================================================
// Фото собранного букета.
//
// Главный страх при заказе цветов — «пришлют не то». Флорист собрал,
// сфотографировал, отправил — клиент видит СВОЙ букет до выезда курьера
// и успевает сказать, если что-то не так.
//
// Отправка отделена от загрузки намеренно: снимок можно переснять и
// заменить, а уйдёт клиенту только то, что флорист сознательно отправил.
// ================================================================

const ORDER_PHOTO_BUCKET = "product-images";
const MAX_ORDER_PHOTO_SIZE = 8 * 1024 * 1024;

export async function uploadAssembledPhoto(
  orderId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireStaff();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Файл не выбран" };
  }
  if (!file.type.startsWith("image/")) {
    return { success: false, error: "Можно загружать только изображения" };
  }
  if (file.size > MAX_ORDER_PHOTO_SIZE) {
    return { success: false, error: "Максимальный размер файла — 8 МБ" };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `orders/${orderId}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await getSupabaseAdmin()
    .storage.from(ORDER_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });

  if (uploadError) {
    console.error("[uploadAssembledPhoto]", uploadError.message);
    return { success: false, error: "Не удалось загрузить фото" };
  }

  const {
    data: { publicUrl },
  } = getSupabaseAdmin().storage.from(ORDER_PHOTO_BUCKET).getPublicUrl(path);

  // Новый снимок сбрасывает отметку об отправке: переснятое фото клиент
  // ещё не видел, и кнопка «Отправить» должна стать доступной снова.
  const { error } = await getSupabaseAdmin()
    .from("orders")
    .update({ assembled_photo_url: publicUrl, assembled_photo_sent_at: null })
    .eq("id", orderId);

  if (error) {
    console.error("[uploadAssembledPhoto] запись в заказ", error.message);
    return { success: false, error: "Фото загрузилось, но не привязалось к заказу" };
  }

  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true };
}

export async function sendAssembledPhoto(orderId: string): Promise<ActionResult> {
  await requireStaff();

  const { data: order } = await getSupabaseAdmin()
    .from("orders")
    .select("assembled_photo_url")
    .eq("id", orderId)
    .maybeSingle();

  if (!order?.assembled_photo_url) {
    return { success: false, error: "Сначала загрузите фото" };
  }

  const result = await sendAssembledPhotoToCustomer(orderId, order.assembled_photo_url);
  if (!result.ok) return { success: false, error: result.reason };

  await getSupabaseAdmin()
    .from("orders")
    .update({ assembled_photo_sent_at: new Date().toISOString() })
    .eq("id", orderId);

  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true };
}
