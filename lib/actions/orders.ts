"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { notifyCustomerAboutStatus, sendAssembledPhotoToCustomer } from "@/lib/telegram/order-notify";
import { requireStaffAction } from "@/lib/auth/server";
import { canUseSiteOrders } from "@/lib/auth/roles";
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
  return requireStaffAction(canUseSiteOrders);
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

/** Потолок на заказ. Двадцать букетов в одном заказе — это уже не розница. */
const MAX_ORDER_PHOTOS = 20;

/**
 * Из публичной ссылки обратно в путь внутри бакета.
 *
 * Разбираем ссылку, а не храним путь отдельной колонкой: пути в массиве
 * и ссылки в массиве пришлось бы держать синхронными, и они однажды
 * разъехались бы. Если ссылка не нашего вида — возвращаем null, и файл
 * просто останется в хранилище.
 */
function storagePathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${ORDER_PHOTO_BUCKET}/`;
  const at = publicUrl.indexOf(marker);
  if (at === -1) return null;
  const path = publicUrl.slice(at + marker.length).split("?")[0];
  return path || null;
}

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

  // Набор читаем ДО загрузки: иначе отказ по лимиту оставил бы файл в
  // хранилище, на который никто не ссылается.
  const { data: current, error: readError } = await getSupabaseAdmin()
    .from("orders")
    .select("assembled_photos")
    .eq("id", orderId)
    .maybeSingle();

  if (readError || !current) {
    console.error("[uploadAssembledPhoto] чтение заказа", readError?.message ?? "нет строки");
    return { success: false, error: "Заказ не найден" };
  }

  const existing = (current.assembled_photos as string[] | null) ?? [];
  if (existing.length >= MAX_ORDER_PHOTOS) {
    return { success: false, error: `Больше ${MAX_ORDER_PHOTOS} фотографий к заказу не прикрепить` };
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

  // Снимок ДОБАВЛЯЕТСЯ к набору, а не заменяет его: в заказе может быть
  // несколько букетов, и каждый нужно показать клиенту отдельно.
  const photos = [...existing, publicUrl];

  // Изменение набора сбрасывает отметку об отправке: этот набор клиент
  // ещё не видел, и кнопка «Отправить» должна стать доступной снова.
  const { error } = await getSupabaseAdmin()
    .from("orders")
    .update({ assembled_photos: photos, assembled_photo_sent_at: null })
    .eq("id", orderId);

  if (error) {
    console.error("[uploadAssembledPhoto] запись в заказ", error.message);
    return { success: false, error: "Фото загрузилось, но не привязалось к заказу" };
  }

  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true };
}

/**
 * Убирает один снимок из набора — флорист переснял букет или добавил лишнее.
 *
 * Файл из хранилища тоже удаляем: иначе за год накопится гора снимков,
 * на которые никто не ссылается. Если удалить файл не вышло, ссылку из
 * заказа всё равно убираем — для флориста важен набор, а осиротевший файл
 * это мусор, а не поломка.
 */
export async function removeAssembledPhoto(orderId: string, photoUrl: string): Promise<ActionResult> {
  await requireStaff();

  const { data: current, error: readError } = await getSupabaseAdmin()
    .from("orders")
    .select("assembled_photos")
    .eq("id", orderId)
    .maybeSingle();

  if (readError || !current) {
    console.error("[removeAssembledPhoto] чтение заказа", readError?.message ?? "нет строки");
    return { success: false, error: "Заказ не найден" };
  }

  const photos = ((current.assembled_photos as string[] | null) ?? []).filter((u) => u !== photoUrl);

  const { error } = await getSupabaseAdmin()
    .from("orders")
    .update({ assembled_photos: photos, assembled_photo_sent_at: null })
    .eq("id", orderId);

  if (error) {
    console.error("[removeAssembledPhoto] запись в заказ", error.message);
    return { success: false, error: "Не удалось убрать фото" };
  }

  const path = storagePathFromPublicUrl(photoUrl);
  if (path) {
    const { error: removeError } = await getSupabaseAdmin()
      .storage.from(ORDER_PHOTO_BUCKET)
      .remove([path]);
    if (removeError) {
      console.error("[removeAssembledPhoto] файл остался в хранилище:", removeError.message);
    }
  }

  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true };
}

export async function sendAssembledPhoto(orderId: string): Promise<ActionResult> {
  await requireStaff();

  const { data: order } = await getSupabaseAdmin()
    .from("orders")
    .select("assembled_photos")
    .eq("id", orderId)
    .maybeSingle();

  const photos = (order?.assembled_photos as string[] | null) ?? [];
  if (photos.length === 0) {
    return { success: false, error: "Сначала загрузите фото" };
  }

  const result = await sendAssembledPhotoToCustomer(orderId, photos);
  if (!result.ok) return { success: false, error: result.reason };

  await getSupabaseAdmin()
    .from("orders")
    .update({ assembled_photo_sent_at: new Date().toISOString() })
    .eq("id", orderId);

  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true };
}
