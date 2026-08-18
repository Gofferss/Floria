"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ================================================================
// Server Actions для админки блога. Права проверяются на каждый вызов
// (getStaffUser читает cookie-сессию через createSupabaseServerClient),
// сама запись/загрузка идёт через service-role-клиент — у blog_posts
// и storage.objects нет INSERT-политик для authenticated, только
// публичный SELECT опубликованных статей (см. миграцию 001).
// ================================================================

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

export type CreateBlogPostInput = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string | null;
  /** Доп. фото для карусели на странице статьи, см. lib/blog.ts BlogPost.galleryImages */
  galleryImages: string[];
  seoTitle: string;
  seoDescription: string;
  isPublished: boolean;
  /** YYYY-MM-DD. Позволяет задать дату задним числом при переносе старых
   *  статей (например, из Яндекс.Бизнеса) — по умолчанию форма подставляет
   *  сегодняшнюю дату, но её можно поменять. Игнорируется для черновиков. */
  publishedAt: string | null;
};

export async function createBlogPost(
  input: CreateBlogPostInput
): Promise<ActionResult<{ id: string; slug: string }>> {
  const staff = await requireStaff();

  const title = input.title.trim();
  const slug = input.slug.trim();
  const content = input.content.trim();

  if (!title) return { success: false, error: "Укажите заголовок статьи" };
  if (!slug) return { success: false, error: "Укажите URL-адрес (slug)" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { success: false, error: "URL-адрес может содержать только латиницу, цифры и дефисы" };
  }
  if (!content) return { success: false, error: "Заполните текст статьи" };

  let publishedAt: string | null = null;
  if (input.isPublished) {
    const parsedDate = input.publishedAt ? new Date(input.publishedAt) : null;
    publishedAt =
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString();
  }

  const { data: post, error } = await getSupabaseAdmin()
    .from("blog_posts")
    .insert({
      author_id: staff.id,
      title,
      slug,
      excerpt: input.excerpt.trim() || null,
      content,
      cover_image: input.coverImage,
      gallery_images: input.galleryImages,
      seo_title: input.seoTitle.trim() || null,
      seo_description: input.seoDescription.trim() || null,
      is_published: input.isPublished,
      published_at: publishedAt,
    })
    .select("id, slug")
    .single();

  if (error || !post) {
    console.error("[createBlogPost]", error?.message);
    if (error?.code === "23505") {
      return { success: false, error: "Статья с таким URL-адресом уже существует" };
    }
    return { success: false, error: "Не удалось сохранить статью" };
  }

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  if (input.isPublished) revalidatePath(`/blog/${post.slug}`);

  return { success: true, data: { id: post.id, slug: post.slug } };
}

export async function updateBlogPost(
  id: string,
  input: CreateBlogPostInput
): Promise<ActionResult<{ id: string; slug: string }>> {
  await requireStaff();

  const title = input.title.trim();
  const slug = input.slug.trim();
  const content = input.content.trim();

  if (!title) return { success: false, error: "Укажите заголовок статьи" };
  if (!slug) return { success: false, error: "Укажите URL-адрес (slug)" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { success: false, error: "URL-адрес может содержать только латиницу, цифры и дефисы" };
  }
  if (!content) return { success: false, error: "Заполните текст статьи" };

  let publishedAt: string | null = null;
  if (input.isPublished) {
    const parsedDate = input.publishedAt ? new Date(input.publishedAt) : null;
    publishedAt =
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString();
  }

  const { data: oldPost } = await getSupabaseAdmin()
    .from("blog_posts")
    .select("slug")
    .eq("id", id)
    .maybeSingle();

  const { data: post, error } = await getSupabaseAdmin()
    .from("blog_posts")
    .update({
      title,
      slug,
      excerpt: input.excerpt.trim() || null,
      content,
      cover_image: input.coverImage,
      gallery_images: input.galleryImages,
      seo_title: input.seoTitle.trim() || null,
      seo_description: input.seoDescription.trim() || null,
      is_published: input.isPublished,
      published_at: publishedAt,
    })
    .eq("id", id)
    .select("id, slug")
    .single();

  if (error || !post) {
    console.error("[updateBlogPost]", error?.message);
    if (error?.code === "23505") {
      return { success: false, error: "Статья с таким URL-адресом уже существует" };
    }
    return { success: false, error: "Не удалось сохранить статью" };
  }

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  revalidatePath(`/blog/${post.slug}`);
  // Slug мог измениться — старый адрес статьи иначе останется в кэше ISR
  // с уже неактуальным контентом (в лучшем случае) или сломанной ссылкой.
  if (oldPost && oldPost.slug !== post.slug) revalidatePath(`/blog/${oldPost.slug}`);

  return { success: true, data: { id: post.id, slug: post.slug } };
}

export type AdminBlogPostDetail = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string | null;
  galleryImages: string[];
  seoTitle: string;
  seoDescription: string;
  isPublished: boolean;
  publishedAt: string | null;
};

/** Одна статья для формы редактирования — включая черновики, автору всё равно. */
export async function getBlogPostForEdit(id: string): Promise<AdminBlogPostDetail | null> {
  await requireStaff();

  const { data, error } = await getSupabaseAdmin()
    .from("blog_posts")
    .select(
      "id, title, slug, excerpt, content, cover_image, gallery_images, seo_title, seo_description, is_published, published_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    excerpt: data.excerpt ?? "",
    content: data.content,
    coverImage: data.cover_image,
    galleryImages: data.gallery_images ?? [],
    seoTitle: data.seo_title ?? "",
    seoDescription: data.seo_description ?? "",
    isPublished: data.is_published,
    publishedAt: data.published_at,
  };
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const BLOG_IMAGES_BUCKET = "blog-images";

async function uploadImageToBucket(
  formData: FormData,
  folder: "covers" | "gallery" | "content"
): Promise<ActionResult<{ url: string }>> {
  await requireStaff();

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
  const path = `${folder}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await getSupabaseAdmin()
    .storage.from(BLOG_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });

  if (uploadError) {
    console.error("[uploadImageToBucket]", uploadError.message);
    return { success: false, error: "Не удалось загрузить изображение. Проверьте, что бакет blog-images создан и публичен" };
  }

  const {
    data: { publicUrl },
  } = getSupabaseAdmin().storage.from(BLOG_IMAGES_BUCKET).getPublicUrl(path);

  return { success: true, data: { url: publicUrl } };
}

/** Обложка статьи — карточка в /blog и шапка статьи. */
export async function uploadBlogCover(formData: FormData): Promise<ActionResult<{ url: string }>> {
  return uploadImageToBucket(formData, "covers");
}

/** Доп. фото — карусель на странице статьи или вставка прямо в текст. */
export async function uploadBlogImage(formData: FormData): Promise<ActionResult<{ url: string }>> {
  return uploadImageToBucket(formData, "gallery");
}
