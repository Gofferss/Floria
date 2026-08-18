"use server";

import { randomUUID } from "crypto";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendMessage, sendPhoto, TelegramApiError } from "@/lib/telegram/bot";
import { listActiveBotUsers, markBotUserBlocked } from "@/lib/telegram/reminders";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// Телеграм ограничивает подпись к фото 1024 символами (обычный текст —
// до 4096), поэтому лимит проверяем только когда есть картинка.
const PHOTO_CAPTION_LIMIT = 1024;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
// Свой бакет заводить ради одной картинки в рассылке избыточно —
// переиспользуем уже существующий blog-images (см. 004_blog_gallery.sql),
// просто под отдельной подпапкой.
const BROADCAST_IMAGES_BUCKET = "blog-images";

export async function uploadBroadcastImage(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const staff = await getStaffUser();
  if (!staff) return { success: false, error: "Доступ только для сотрудников" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Файл не выбран" };
  }
  if (!file.type.startsWith("image/")) {
    return { success: false, error: "Можно загружать только изображения" };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { success: false, error: "Максимальный размер файла — 5 МБ" };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `broadcast/${randomUUID()}.${ext}`;

  const { error: uploadError } = await getSupabaseAdmin()
    .storage.from(BROADCAST_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });

  if (uploadError) {
    console.error("[uploadBroadcastImage]", uploadError.message);
    return { success: false, error: "Не удалось загрузить изображение" };
  }

  const {
    data: { publicUrl },
  } = getSupabaseAdmin().storage.from(BROADCAST_IMAGES_BUCKET).getPublicUrl(path);

  return { success: true, data: { url: publicUrl } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type BroadcastSummary = { total: number; sent: number; failed: number };

/**
 * Рассылка всем, кто хоть раз нажал /start у бота-напоминальщика (не
 * только тем, у кого есть активные напоминания) — для кампаний вроде
 * "предзаказы к 8 марта открыты". Небольшая пауза между отправками —
 * подстраховка от лимита Bot API (антиспам на массовые отправки), для
 * реального размера базы малого бизнеса с запасом достаточно.
 */
export async function sendBroadcast(
  message: string,
  imageUrl: string | null
): Promise<ActionResult<BroadcastSummary>> {
  const staff = await getStaffUser();
  if (!staff) return { success: false, error: "Доступ только для сотрудников" };

  const text = message.trim();
  if (!text && !imageUrl) return { success: false, error: "Введите текст рассылки или добавьте фото" };
  if (imageUrl && text.length > PHOTO_CAPTION_LIMIT) {
    return { success: false, error: `С фото текст ограничен ${PHOTO_CAPTION_LIMIT} символами — сократите или уберите фото` };
  }

  const users = await listActiveBotUsers();
  if (users.length === 0) {
    return { success: false, error: "Пока нет ни одного подписчика бота" };
  }

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      if (imageUrl) {
        await sendPhoto(user.chatId, imageUrl, text || undefined);
      } else {
        await sendMessage(user.chatId, text);
      }
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`[sendBroadcast] chat ${user.chatId}:`, error);
      if (error instanceof TelegramApiError && error.errorCode === 403) {
        await markBotUserBlocked(user.chatId);
      }
    }
    await sleep(50);
  }

  return { success: true, data: { total: users.length, sent, failed } };
}
