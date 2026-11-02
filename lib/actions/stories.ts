"use server";

import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { revalidatePath } from "next/cache";
import { requireStaffAction } from "@/lib/auth/server";
import { IMAGE_TYPE_ERROR, imageExtension } from "@/lib/image-upload";
import { canUseSiteAdmin } from "@/lib/auth/roles";
import { getSupabaseAdmin } from "@/lib/supabase";
import { StoryVideoError, transcodeStoryVideo } from "@/lib/video/story-video";
import { MAX_STORY_VIDEO_SECONDS, STORY_VIDEO_MAX_BYTES, storyVideoExtension } from "@/lib/video/story-video-limits";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function requireStaff() {
  return requireStaffAction(canUseSiteAdmin);
}

export type StoryItemInput = {
  mediaType: "image" | "video";
  /** Адрес фото или ролика (в базе — колонка image_url). */
  mediaUrl: string;
  /** Кадр-обложка ролика; у фото — null. */
  posterUrl: string | null;
  /** У фото — сколько секунд показывать; у ролика — его длина. */
  durationSeconds: number;
  /** Кнопка на слайде — необязательна. Пустая строка = кнопки нет. */
  linkUrl: string;
  linkLabel: string;
};

/** Ролик и обложка должны лежать в нашем хранилище — их адрес попадает в <video>. */
function isOwnStorageUrl(url: string | null): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  return !!url && !!base && url.startsWith(`${base}/storage/v1/object/public/`);
}

/** Чем показать историю в кружке: у ролика — его обложкой. */
function coverFor(item: StoryItemInput | undefined): string | null {
  if (!item) return null;
  return item.mediaType === "video" ? item.posterUrl : item.mediaUrl;
}

/**
 * Разрешаем только http(s) и внутренние пути.
 *
 * Отсекаем прежде всего javascript:-адрес: он выполнил бы код в браузере
 * посетителя при клике по кнопке. Заодно не пускаем протокол-относительные
 * "//чужой-сайт" — визуально они похожи на внутренний путь, но уводят с
 * сайта. Такое же ограничение стоит и в самой БД (миграция 014), здесь оно
 * ради понятного сообщения об ошибке, а не вместо него.
 */
function normalizeStoryLink(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (/^https?:\/\//i.test(value)) return { ok: true, value };
  if (/^\/[^/]/.test(value)) return { ok: true, value };
  return {
    ok: false,
    error: 'Ссылка должна начинаться с https:// или с / — например, /catalog',
  };
}

export type StoryInput = {
  title: string;
  coverImage: string | null;
  sortOrder: number;
  isActive: boolean;
  items: StoryItemInput[];
};

export type AdminStory = StoryInput & { id: string; itemCount: number };
export type AdminStoryDetail = StoryInput & { id: string };

function validateStoryInput(input: StoryInput): string | null {
  if (!input.title.trim()) return "Укажите название";
  if (input.items.length === 0) return "Добавьте хотя бы одно фото или видео";

  for (const [index, item] of input.items.entries()) {
    if (item.mediaType !== "image" && item.mediaType !== "video") return `Слайд ${index + 1}: неизвестный вид`;
    if (item.mediaType === "video" && !(isOwnStorageUrl(item.mediaUrl) && isOwnStorageUrl(item.posterUrl))) {
      return `Слайд ${index + 1}: видео не загружено — добавьте его заново`;
    }
    const link = normalizeStoryLink(item.linkUrl ?? "");
    if (!link.ok) return `Слайд ${index + 1}: ${link.error}`;
  }

  return null;
}

export async function listStoriesAdmin(): Promise<AdminStory[]> {
  await requireStaff();

  const { data, error } = await getSupabaseAdmin()
    .from("stories")
    .select("id, title, cover_image, sort_order, is_active, story_items(count)")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[listStoriesAdmin]", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    coverImage: row.cover_image,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    items: [],
    itemCount: (row.story_items as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));
}

export async function getStoryForEdit(id: string): Promise<AdminStoryDetail | null> {
  await requireStaff();

  const { data: story, error } = await getSupabaseAdmin()
    .from("stories")
    .select("id, title, cover_image, sort_order, is_active")
    .eq("id", id)
    .maybeSingle();

  if (error || !story) return null;

  const { data: items } = await getSupabaseAdmin()
    .from("story_items")
    .select("image_url, media_type, poster_url, duration_seconds, link_url, link_label")
    .eq("story_id", id)
    .order("sort_order", { ascending: true });

  return {
    id: story.id,
    title: story.title,
    coverImage: story.cover_image,
    sortOrder: story.sort_order,
    isActive: story.is_active,
    items: (items ?? []).map((item) => ({
      mediaType: item.media_type === "video" ? "video" : "image",
      mediaUrl: item.image_url,
      posterUrl: item.poster_url,
      durationSeconds: item.duration_seconds,
      linkUrl: item.link_url ?? "",
      linkLabel: item.link_label ?? "",
    })),
  };
}

/**
 * Заменяет слайды истории. Сначала пишем новые, и только потом убираем
 * старые: раньше было наоборот, и ошибка записи оставляла историю вовсе
 * без слайдов, а сотрудник видел «сохранено» — ошибка уходила только в журнал.
 */
async function replaceStoryItems(storyId: string, items: StoryItemInput[]): Promise<string | null> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: old, error: readError } = await supabaseAdmin.from("story_items").select("id").eq("story_id", storyId);
  if (readError) {
    console.error("[replaceStoryItems] чтение", readError.message);
    return "Не удалось сохранить слайды";
  }

  const rows = items.map((item, index) => {
    const link = normalizeStoryLink(item.linkUrl ?? "");
    const linkUrl = link.ok ? link.value : null;
    const linkLabel = item.linkLabel?.trim() || null;
    const isVideo = item.mediaType === "video";
    return {
      story_id: storyId,
      image_url: item.mediaUrl,
      media_type: isVideo ? "video" : "image",
      poster_url: isVideo ? item.posterUrl : null,
      duration_seconds: Math.min(Math.max(Math.round(item.durationSeconds) || 5, 1), isVideo ? MAX_STORY_VIDEO_SECONDS : 600),
      sort_order: index,
      link_url: linkUrl,
      // Подпись без ссылки бессмысленна — не сохраняем висячий текст.
      link_label: linkUrl ? linkLabel : null,
    };
  });
  if (rows.length > 0) {
    const { error } = await supabaseAdmin.from("story_items").insert(rows);
    if (error) {
      console.error("[replaceStoryItems] запись", error.message);
      return "Не удалось сохранить слайды — прежние оставлены как были";
    }
  }

  const oldIds = (old ?? []).map((row) => row.id);
  if (oldIds.length > 0) {
    const { error } = await supabaseAdmin.from("story_items").delete().in("id", oldIds);
    if (error) {
      console.error("[replaceStoryItems] удаление прежних", error.message);
      return "Новые слайды сохранены, но прежние не убрались — сохраните ещё раз";
    }
  }
  return null;
}

export async function createStory(input: StoryInput): Promise<ActionResult<{ id: string }>> {
  await requireStaff();

  const validationError = validateStoryInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data: story, error } = await getSupabaseAdmin()
    .from("stories")
    .insert({
      title: input.title.trim(),
      cover_image: input.coverImage ?? coverFor(input.items[0]),
      sort_order: input.sortOrder,
      is_active: input.isActive,
    })
    .select("id")
    .single();

  if (error || !story) {
    console.error("[createStory]", error?.message);
    return { success: false, error: "Не удалось сохранить историю" };
  }

  const itemsError = await replaceStoryItems(story.id, input.items);
  if (itemsError) {
    // История без слайдов никому не нужна — убираем её, форма остаётся заполненной.
    await getSupabaseAdmin().from("stories").delete().eq("id", story.id);
    return { success: false, error: itemsError };
  }

  revalidatePath("/admin/stories");
  revalidatePath("/");
  return { success: true, data: { id: story.id } };
}

export async function updateStory(id: string, input: StoryInput): Promise<ActionResult<{ id: string }>> {
  await requireStaff();

  const validationError = validateStoryInput(input);
  if (validationError) return { success: false, error: validationError };

  const { error } = await getSupabaseAdmin()
    .from("stories")
    .update({
      title: input.title.trim(),
      cover_image: input.coverImage ?? coverFor(input.items[0]),
      sort_order: input.sortOrder,
      is_active: input.isActive,
    })
    .eq("id", id);

  if (error) {
    console.error("[updateStory]", error.message);
    return { success: false, error: "Не удалось сохранить историю" };
  }

  const itemsError = await replaceStoryItems(id, input.items);
  if (itemsError) return { success: false, error: itemsError };

  revalidatePath("/admin/stories");
  revalidatePath("/");
  return { success: true, data: { id } };
}

/** Показать/скрыть историю — не удаляем, просто снимаем с публичного показа. */
export async function toggleStoryActive(id: string, isActive: boolean): Promise<ActionResult<null>> {
  await requireStaff();

  const { error } = await getSupabaseAdmin().from("stories").update({ is_active: isActive }).eq("id", id);

  if (error) {
    console.error("[toggleStoryActive]", error.message);
    return { success: false, error: "Не удалось изменить статус истории" };
  }

  revalidatePath("/admin/stories");
  revalidatePath("/");
  return { success: true, data: null };
}

export async function deleteStory(id: string): Promise<ActionResult<null>> {
  await requireStaff();

  const { error } = await getSupabaseAdmin().from("stories").delete().eq("id", id);
  if (error) {
    console.error("[deleteStory]", error.message);
    return { success: false, error: "Не удалось удалить историю" };
  }

  revalidatePath("/admin/stories");
  revalidatePath("/");
  return { success: true, data: null };
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const STORY_IMAGES_BUCKET = "product-images";

export async function uploadStoryImage(formData: FormData): Promise<ActionResult<{ url: string }>> {
  await requireStaff();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Файл не выбран" };
  }
  const ext = imageExtension(file.type);
  if (!ext) {
    return { success: false, error: IMAGE_TYPE_ERROR };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { success: false, error: "Максимальный размер файла — 5 МБ" };
  }

  const path = `stories/${randomUUID()}.${ext}`;

  const { error: uploadError } = await getSupabaseAdmin()
    .storage.from(STORY_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });

  if (uploadError) {
    console.error("[uploadStoryImage]", uploadError.message);
    return { success: false, error: "Не удалось загрузить изображение" };
  }

  const {
    data: { publicUrl },
  } = getSupabaseAdmin().storage.from(STORY_IMAGES_BUCKET).getPublicUrl(path);

  return { success: true, data: { url: publicUrl } };
}

// ---------------------------------------------------------------
// Видео. Исходник с телефона весит до 200 МБ — через серверное действие
// (предел тела 8 МБ, next.config.mjs) он не пройдёт. Поэтому браузер
// грузит его прямо в хранилище по одноразовой ссылке, а сервер потом
// забирает, пережимает (lib/video/story-video.ts) и исходник удаляет.
// ---------------------------------------------------------------

const STORY_VIDEOS_BUCKET = "story-videos";
const INCOMING_PATH = /^incoming\/[0-9a-f-]{36}\.(mp4|mov|webm|3gp|m4v)$/;

export async function createStoryVideoUpload(
  type: string,
  size: number
): Promise<ActionResult<{ path: string; token: string }>> {
  await requireStaff();

  const ext = storyVideoExtension(type);
  if (!ext) return { success: false, error: "Видео — в формате MP4, MOV или WebM" };
  if (!(size > 0) || size > STORY_VIDEO_MAX_BYTES) {
    return { success: false, error: "Видео больше 200 МБ — обрежьте его или снимите в 1080p" };
  }

  const uploadPath = `incoming/${randomUUID()}.${ext}`;
  const { data, error } = await getSupabaseAdmin().storage.from(STORY_VIDEOS_BUCKET).createSignedUploadUrl(uploadPath);
  if (error || !data) {
    console.error("[createStoryVideoUpload]", error?.message);
    return { success: false, error: "Не удалось подготовить загрузку видео" };
  }
  return { success: true, data: { path: uploadPath, token: data.token } };
}

export type ProcessedStoryVideo = {
  videoUrl: string;
  posterUrl: string;
  durationSeconds: number;
  trimmed: boolean;
};

export async function processStoryVideo(incomingPath: string): Promise<ActionResult<ProcessedStoryVideo>> {
  await requireStaff();
  if (!INCOMING_PATH.test(incomingPath)) return { success: false, error: "Неизвестный файл видео" };

  const admin = getSupabaseAdmin();
  const videos = admin.storage.from(STORY_VIDEOS_BUCKET);
  const images = admin.storage.from(STORY_IMAGES_BUCKET);
  const workDir = await mkdtemp(path.join(tmpdir(), "story-video-"));

  try {
    const source = path.join(workDir, `source${path.extname(incomingPath)}`);
    const response = await fetch(videos.getPublicUrl(incomingPath).data.publicUrl, { cache: "no-store" });
    if (!response.ok || !response.body) {
      console.error("[processStoryVideo] исходник не скачался:", response.status);
      return { success: false, error: "Загруженное видео не нашлось — добавьте его ещё раз" };
    }
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), createWriteStream(source));

    const result = await transcodeStoryVideo(source, workDir);

    const id = randomUUID();
    const videoPath = `stories/${id}.mp4`;
    const posterPath = `stories/${id}.jpg`;
    // Имена файлов уникальны и не меняются — кешировать можно надолго.
    const { error: videoError } = await videos.upload(videoPath, await readFile(result.videoFile), {
      contentType: "video/mp4",
      cacheControl: "31536000",
      upsert: false,
    });
    if (videoError) {
      console.error("[processStoryVideo] запись ролика", videoError.message);
      return { success: false, error: "Не удалось сохранить обработанное видео" };
    }
    const { error: posterError } = await images.upload(posterPath, await readFile(result.posterFile), {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
    if (posterError) {
      console.error("[processStoryVideo] запись обложки", posterError.message);
      await videos.remove([videoPath]);
      return { success: false, error: "Не удалось сохранить обложку видео" };
    }

    return {
      success: true,
      data: {
        videoUrl: videos.getPublicUrl(videoPath).data.publicUrl,
        posterUrl: images.getPublicUrl(posterPath).data.publicUrl,
        durationSeconds: result.durationSeconds,
        trimmed: result.trimmed,
      },
    };
  } catch (error) {
    if (error instanceof StoryVideoError) return { success: false, error: error.message };
    console.error("[processStoryVideo]", error);
    return { success: false, error: "Не удалось обработать видео" };
  } finally {
    await rm(workDir, { recursive: true, force: true });
    // Исходник больше не нужен ни при успехе, ни при ошибке.
    const { error } = await videos.remove([incomingPath]);
    if (error) console.error("[processStoryVideo] исходник не удалён:", incomingPath, error.message);
  }
}
