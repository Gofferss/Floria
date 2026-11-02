// Какие ролики принимаем в сторис — общее для формы и сервера.
// Здесь нет ничего серверного: файл подключает и браузерная форма.

/** Длиннее — сервер обрежет до этой длины. */
export const MAX_STORY_VIDEO_SECONDS = 60;

/** Исходник с телефона: минута 4K с айфона — около 190 МБ. */
export const STORY_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

const VIDEO_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/3gpp": "3gp",
  "video/x-m4v": "m4v",
};

const TYPE_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(VIDEO_EXTENSIONS).map(([type, ext]) => [ext, type])
);

export const STORY_VIDEO_ACCEPT = [...Object.keys(VIDEO_EXTENSIONS), ...Object.values(VIDEO_EXTENSIONS).map((e) => `.${e}`)].join(",");

/**
 * Тип ролика или null, если это не поддерживаемое видео. Часть браузеров
 * на Android отдаёт у видео пустой тип — тогда судим по расширению.
 */
export function storyVideoType(file: { type: string; name: string }): string | null {
  const type = file.type.toLowerCase();
  if (VIDEO_EXTENSIONS[type]) return type;
  if (type && type !== "application/octet-stream") return null;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[ext] ?? null;
}

export function storyVideoExtension(type: string): string | null {
  return VIDEO_EXTENSIONS[type] ?? null;
}

/** Похоже на видео — по типу или расширению; поддерживаемое ли — решает storyVideoType. */
export function looksLikeVideo(file: { type: string; name: string }): boolean {
  return file.type.startsWith("video/") || storyVideoType(file) !== null;
}
