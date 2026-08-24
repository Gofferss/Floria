"use client";

// ================================================================
// Подготовка фотографии к загрузке — прямо в браузере, до отправки.
//
// Зачем понадобилось. Снимок с айфона не проходил на сайт по двум
// причинам сразу:
//
//   1. Формат HEIC. Это родной формат камеры Apple, и загрузить его
//      «как есть» бессмысленно — ни один браузер, кроме Safari, не
//      умеет его показывать. Владельцу приходилось прогонять каждое
//      фото через сторонние сайты-конвертеры.
//   2. Размер. Даже когда iOS сам отдавал JPEG, снимок весил 4–8 МБ и
//      упирался в серверный предел. Причём в каталоге это фото всё
//      равно показывается шириной от силы 800 пикселей.
//
// Что делаем. Рисуем картинку на canvas и выгружаем обратно как JPEG,
// уменьшив до разумного размера. Это разом решает обе проблемы:
// декодированием занимается сам браузер (а Safari на айфоне HEIC
// читает), на выходе всегда JPEG, и вес падает в 10–20 раз.
//
// Ограничение, о котором нужно знать. HEIC, открытый НЕ в Safari
// (например, скинули файл на компьютер и грузят из Chrome), браузер
// декодировать не сможет — тогда честно вернём ошибку с понятным
// текстом, а не молча испортим файл. Городить сюда JS-декодер HEIC
// ради этого случая не стали: с айфона грузят из Safari, а на
// компьютере пересохранить в JPEG — одно действие.
// ================================================================

/** Больше этой стороны фото на сайте нигде не показывается. */
const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;

/** Меньше этого не трогаем — пережимать и так лёгкий файл незачем. */
const SKIP_BELOW_BYTES = 400 * 1024;

export type PrepareResult =
  | { ok: true; file: File; wasConverted: boolean }
  | { ok: false; error: string };

function isHeic(file: File): boolean {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap быстрее и не требует DOM, но в части браузеров не
  // принимает HEIC — тогда пробуем обычный <img>, который в Safari его читает.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // падаем в запасной путь ниже
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode"));
      img.src = url;
    });
  } finally {
    // Отзываем ссылку в любом случае: без этого объект висит в памяти
    // вкладки до её закрытия, а фотографии тяжёлые.
    URL.revokeObjectURL(url);
  }
}

export async function prepareImageForUpload(file: File): Promise<PrepareResult> {
  const heic = isHeic(file);

  // Лёгкий обычный JPEG/PNG пропускаем как есть — незачем перекодировать.
  if (!heic && file.size <= SKIP_BELOW_BYTES) {
    return { ok: true, file, wasConverted: false };
  }

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return {
      ok: false,
      error: heic
        ? "Этот формат (HEIC) браузер открыть не смог. Откройте сайт на айфоне — там он читается, — или пересохраните фото в JPEG."
        : "Не удалось прочитать файл. Убедитесь, что это изображение.",
    };
  }

  const width = "width" in bitmap ? bitmap.width : 0;
  const height = "height" in bitmap ? bitmap.height : 0;
  if (!width || !height) return { ok: false, error: "Не удалось определить размер изображения" };

  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, error: "Браузер не дал обработать изображение" };

  // Белая подложка: у PNG с прозрачностью она иначе станет чёрной в JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  if ("close" in bitmap) bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) return { ok: false, error: "Не удалось сохранить обработанное изображение" };

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return {
    ok: true,
    file: new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }),
    wasConverted: true,
  };
}
