import { supabase } from "@/lib/supabase";

// ================================================================
// Блог: выборка из Supabase (таблица blog_posts, см. миграцию 000 —
// схема и RLS уже существовали до этого шага, здесь только реальные
// запросы вместо мока).
//
// content хранится плоским TEXT (HTML) — не структурированными блоками,
// как в прежнем моке. Рендерится через .prose (Tailwind Typography),
// см. app/blog/[slug]/page.tsx. Админку, которая будет писать HTML в
// это поле, делаем следующим шагом — здесь только чтение.
//
// Как и lib/products.ts, все функции асинхронные — вызывать только из
// серверных компонентов.
// ================================================================

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  /** HTML. Рендерится через dangerouslySetInnerHTML внутри .prose —
   *  безопасно, пока писать сюда может только is_staff() (см. RLS в
   *  миграции 000). Когда появится админка — редактор должен либо сам
   *  санитизировать HTML, либо быть WYSIWYG с ограниченным набором
   *  тегов, а не голым textarea, принимающим произвольный HTML. */
  content: string;
  coverImage: string | null;
  /** Доп. фото статьи — карусель на странице статьи (см. PhotoCarousel).
   *  Отдельно от coverImage (карточка в /blog) и от картинок внутри
   *  content (коллаж текст/фото, вставляется прямо в HTML). */
  galleryImages: string[];
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

type BlogPostRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  cover_image: string | null;
  gallery_images: string[] | null;
  published_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
};

const POST_SELECT =
  "id, title, slug, excerpt, content, cover_image, gallery_images, published_at, seo_title, seo_description";

function mapRow(row: BlogPostRow): BlogPost {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: row.content,
    coverImage: row.cover_image,
    galleryImages: row.gallery_images ?? [],
    publishedAt: row.published_at,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
  };
}

/**
 * Ошибки запроса логируем и возвращаем пустой результат, а не бросаем
 * исключение — тот же принцип, что в lib/products.ts: недоступность
 * БД не должна ронять страницу, а не показывать пустое состояние.
 */
function handleError(context: string, error: { message: string } | null): boolean {
  if (!error) return false;
  console.error(`[blog] ${context}:`, error.message);
  return true;
}

/** Все опубликованные статьи, свежие сверху */
export async function getPublishedPosts(): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select(POST_SELECT)
    .eq("is_published", true)
    .order("published_at", { ascending: false });

  if (handleError("getPublishedPosts", error) || !data) return [];
  return (data as BlogPostRow[]).map(mapRow);
}

/** Одна статья по слагу. null, если не найдена или ещё не опубликована. */
export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select(POST_SELECT)
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (handleError(`getPostBySlug(${slug})`, error) || !data) return null;
  return mapRow(data as BlogPostRow);
}

/** Только слаги опубликованных статей — для generateStaticParams */
export async function getPublishedSlugs(): Promise<string[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("slug")
    .eq("is_published", true);

  if (handleError("getPublishedSlugs", error) || !data) return [];
  return data.map((row) => row.slug as string);
}

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatPublishedDate(isoDate: string | null): string {
  if (!isoDate) return "";
  return dateFormatter.format(new Date(isoDate));
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Транслитерация заголовка в URL-friendly slug: "Розы к 8 марта" → "rozy-k-8-marta" */
export function slugify(input: string): string {
  const transliterated = input
    .toLowerCase()
    .split("")
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join("");

  return transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
