import { createStoryVideoUpload, processStoryVideo, type ProcessedStoryVideo } from "@/lib/actions/stories";
import { STORY_VIDEO_MAX_BYTES, storyVideoType } from "@/lib/video/story-video-limits";

// ================================================================
// Загрузка ролика в сторис из браузера.
//
// Исходник идёт прямо в хранилище по одноразовой ссылке — мимо сервера
// сайта, у которого предел тела запроса 8 МБ. XMLHttpRequest, а не
// supabase-js: только он умеет сообщать, сколько уже отправлено, а ролик
// в 100 МБ с мобильного интернета грузится минуты — без процентов это
// выглядело бы как зависание.
// ================================================================

export type VideoUploadStage = { stage: "upload"; progress: number } | { stage: "process" };

export async function uploadStoryVideo(
  file: File,
  onStage: (stage: VideoUploadStage) => void
): Promise<{ ok: true; video: ProcessedStoryVideo } | { ok: false; error: string }> {
  const type = storyVideoType(file);
  if (!type) return { ok: false, error: "Видео — в формате MP4, MOV или WebM" };
  if (file.size > STORY_VIDEO_MAX_BYTES) {
    return { ok: false, error: "Видео больше 200 МБ — обрежьте его или снимите в 1080p" };
  }

  const ticket = await createStoryVideoUpload(type, file.size);
  if (!ticket.success) return { ok: false, error: ticket.error };

  onStage({ stage: "upload", progress: 0 });
  try {
    await putToStorage(ticket.data.path, ticket.data.token, file, type, (progress) => onStage({ stage: "upload", progress }));
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  onStage({ stage: "process" });
  const processed = await processStoryVideo(ticket.data.path);
  return processed.success ? { ok: true, video: processed.data } : { ok: false, error: processed.error };
}

function putToStorage(
  path: string,
  token: string,
  file: File,
  type: string,
  onProgress: (share: number) => void
): Promise<void> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const url = `${base}/storage/v1/object/upload/sign/story-videos/${path}?token=${encodeURIComponent(token)}`;

  // Тип — проверенный, а не из файла: у части Android он пустой, и
  // хранилище отвергло бы ролик как «не видео».
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file.type === type ? file : new File([file], file.name, { type }));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anonKey) xhr.setRequestHeader("apikey", anonKey);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = "";
      try {
        message = (JSON.parse(xhr.responseText) as { message?: string }).message ?? "";
      } catch {
        // не JSON — покажем код ответа
      }
      reject(new Error(`Хранилище не приняло видео${message ? `: ${message}` : ` (код ${xhr.status})`}`));
    };
    xhr.onerror = () => reject(new Error("Связь оборвалась при загрузке видео — попробуйте ещё раз"));
    xhr.send(body);
  });
}
