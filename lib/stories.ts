import { supabase } from "@/lib/supabase";

// ================================================================
// «Сторис» на главной — кружки-актуальное, как в Instagram. Читаем
// анонимным ключом — RLS отдаёт только активные истории и их фото
// (см. migrations/008_promo_codes_and_stories.sql). Запись — только
// из /admin/stories (lib/actions/stories.ts, service-role).
// ================================================================

export type StorySlide = {
  imageUrl: string;
  durationSeconds: number;
};

export type Story = {
  id: string;
  title: string;
  coverImage: string | null;
  items: StorySlide[];
};

export async function getActiveStories(): Promise<Story[]> {
  const { data, error } = await supabase
    .from("stories")
    .select("id, title, cover_image, story_items ( image_url, duration_seconds, sort_order )")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getActiveStories]", error.message);
    return [];
  }

  type Row = {
    id: string;
    title: string;
    cover_image: string | null;
    story_items: { image_url: string; duration_seconds: number; sort_order: number }[] | null;
  };

  return ((data ?? []) as unknown as Row[])
    .map((row) => ({
      id: row.id,
      title: row.title,
      coverImage: row.cover_image,
      items: (row.story_items ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => ({ imageUrl: item.image_url, durationSeconds: item.duration_seconds })),
    }))
    // История без фото — нечего показывать, отфильтровываем.
    .filter((story) => story.items.length > 0);
}
