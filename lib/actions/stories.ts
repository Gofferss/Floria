"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) throw new Error("Доступ только для сотрудников");
  return staff;
}

export type StoryItemInput = { imageUrl: string; durationSeconds: number };

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
  if (input.items.length === 0) return "Добавьте хотя бы одно фото";
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
    .select("image_url, duration_seconds")
    .eq("story_id", id)
    .order("sort_order", { ascending: true });

  return {
    id: story.id,
    title: story.title,
    coverImage: story.cover_image,
    sortOrder: story.sort_order,
    isActive: story.is_active,
    items: (items ?? []).map((item) => ({ imageUrl: item.image_url, durationSeconds: item.duration_seconds })),
  };
}

async function replaceStoryItems(storyId: string, items: StoryItemInput[]): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  await supabaseAdmin.from("story_items").delete().eq("story_id", storyId);
  if (items.length === 0) return;

  const rows = items.map((item, index) => ({
    story_id: storyId,
    image_url: item.imageUrl,
    duration_seconds: item.durationSeconds,
    sort_order: index,
  }));
  const { error } = await supabaseAdmin.from("story_items").insert(rows);
  if (error) console.error("[replaceStoryItems]", error.message);
}

export async function createStory(input: StoryInput): Promise<ActionResult<{ id: string }>> {
  await requireStaff();

  const validationError = validateStoryInput(input);
  if (validationError) return { success: false, error: validationError };

  const { data: story, error } = await getSupabaseAdmin()
    .from("stories")
    .insert({
      title: input.title.trim(),
      cover_image: input.coverImage ?? input.items[0]?.imageUrl ?? null,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    })
    .select("id")
    .single();

  if (error || !story) {
    console.error("[createStory]", error?.message);
    return { success: false, error: "Не удалось сохранить историю" };
  }

  await replaceStoryItems(story.id, input.items);

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
      cover_image: input.coverImage ?? input.items[0]?.imageUrl ?? null,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    })
    .eq("id", id);

  if (error) {
    console.error("[updateStory]", error.message);
    return { success: false, error: "Не удалось сохранить историю" };
  }

  await replaceStoryItems(id, input.items);

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
  if (!file.type.startsWith("image/")) {
    return { success: false, error: "Можно загружать только изображения" };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { success: false, error: "Максимальный размер файла — 5 МБ" };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
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
