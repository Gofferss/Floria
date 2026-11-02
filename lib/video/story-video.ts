import { spawn } from "child_process";
import path from "path";
import { MAX_STORY_VIDEO_SECONDS } from "./story-video-limits";

// ================================================================
// Видео для сторис: любой ролик с телефона → MP4 (H.264 + AAC), 720p.
//
// Почему пережимаем, а не кладём как есть:
//   - айфон по умолчанию снимает в HEVC, а его не показывают Firefox и
//     часть Android и Windows — у них вместо ролика был бы чёрный кадр;
//   - ролик с телефона весит 30–200 МБ, и посетитель с мобильного
//     интернета ждал бы его минуту. 720p в H.264 — несколько мегабайт;
//   - +faststart кладёт оглавление файла в начало: ролик начинает
//     играть, не дожидаясь загрузки целиком;
//   - HDR (айфон снимает его по умолчанию) переводим в обычный цвет,
//     иначе на обычных экранах ролик выглядит блёклым;
//   - метаданные убираем: в роликах с телефона лежат координаты съёмки.
// Обложку (кружок на главной и кадр до загрузки ролика) берём из уже
// пережатого файла — у него правильный поворот.
//
// ffmpeg ставится в образ сайта через nixpacks.toml.
// ================================================================

const SHORT_SIDE = 720;
const MAX_FPS = 30;
const TIMEOUT_MS = 4 * 60_000;

/** Ошибка, текст которой можно показать сотруднику как есть. */
export class StoryVideoError extends Error {}

export type StoryVideoResult = {
  videoFile: string;
  posterFile: string;
  durationSeconds: number;
  /** Ролик был длиннее минуты и обрезан. */
  trimmed: boolean;
};

type RunResult = { code: number; stdout: string; stderr: string };

function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    // Хвоста хватает, чтобы понять ошибку; весь журнал ffmpeg не копим.
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8_000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

type Probe = { duration: number; hdr: boolean };

async function probe(file: string): Promise<Probe> {
  const result = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type,color_transfer", "-of", "json", file],
    30_000
  );
  if (result.code !== 0) throw new StoryVideoError("Не удалось прочитать видео — файл повреждён или это не видео");

  type Stream = { codec_type?: string; color_transfer?: string };
  const data = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Stream[] };
  const video = (data.streams ?? []).find((s) => s.codec_type === "video");
  if (!video) throw new StoryVideoError("В файле нет видео");

  const duration = Number(data.format?.duration);
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    // HLG — так снимает айфон, PQ — HDR10 и Dolby Vision с других телефонов.
    hdr: video.color_transfer === "arib-std-b67" || video.color_transfer === "smpte2084",
  };
}

function videoFilter(hdr: boolean): string {
  // Короткая сторона — не больше 720: вертикальный ролик станет 720×1280,
  // горизонтальный — ×720 по высоте (в окне сторис он обрезается по бокам,
  // и при узком кадре качество кончилось бы раньше). Размеры чётные —
  // иначе H.264 их не примет.
  const scale =
    `scale=w='if(gt(iw,ih),-2,trunc(min(${SHORT_SIDE},iw)/2)*2)'` +
    `:h='if(gt(iw,ih),trunc(min(${SHORT_SIDE},ih)/2)*2,-2)'`;
  if (!hdr) return `${scale},format=yuv420p`;
  return [
    scale,
    "zscale=t=linear:npl=100",
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p",
  ].join(",");
}

/**
 * Пережимает ролик input в рабочей папке workDir. Бросает StoryVideoError
 * с понятным текстом; прочие ошибки (нет ffmpeg и т.п.) — как есть.
 */
export async function transcodeStoryVideo(input: string, workDir: string): Promise<StoryVideoResult> {
  const { duration, hdr } = await probe(input);
  const videoFile = path.join(workDir, "story.mp4");
  const posterFile = path.join(workDir, "poster.jpg");

  const encodeWith = (toneMap: boolean) =>
    run(
      "ffmpeg",
      [
        "-hide_banner", "-nostdin", "-y",
        "-protocol_whitelist", "file",
        "-i", input,
        "-t", String(MAX_STORY_VIDEO_SECONDS),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", videoFilter(toneMap),
        "-fpsmax", String(MAX_FPS),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-profile:v", "high", "-level:v", "4.0",
        ...(toneMap ? ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"] : []),
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-map_metadata", "-1",
        "-movflags", "+faststart",
        // Сервер общий с базой — не забираем все ядра под одно видео.
        "-threads", "2",
        videoFile,
      ],
      TIMEOUT_MS
    );

  let encode = await encodeWith(hdr);
  if (encode.code !== 0 && hdr) {
    // Перевод HDR капризен: файл с необычной разметкой цвета он не берёт
    // («no path between colorspaces»). Блёклый ролик лучше, чем никакого.
    console.error("[transcodeStoryVideo] HDR не перевёлся, пережимаем как есть:", encode.stderr.slice(-1_000));
    encode = await encodeWith(false);
  }
  if (encode.code !== 0) {
    console.error("[transcodeStoryVideo] ffmpeg:", encode.stderr.slice(-2_000));
    throw new StoryVideoError("Не удалось обработать видео. Попробуйте другой файл или пришлите его разработчику");
  }

  const kept = Math.min(duration || MAX_STORY_VIDEO_SECONDS, MAX_STORY_VIDEO_SECONDS);
  const posterAt = Math.min(0.3, kept / 2);
  const poster = await run(
    "ffmpeg",
    ["-hide_banner", "-nostdin", "-y", "-ss", posterAt.toFixed(2), "-i", videoFile, "-frames:v", "1", "-q:v", "3", posterFile],
    60_000
  );
  if (poster.code !== 0) {
    console.error("[transcodeStoryVideo] обложка:", poster.stderr.slice(-2_000));
    throw new StoryVideoError("Видео обработано, но не удалось сделать обложку");
  }

  return {
    videoFile,
    posterFile,
    durationSeconds: Math.max(1, Math.round(kept)),
    trimmed: duration > MAX_STORY_VIDEO_SECONDS + 0.5,
  };
}
