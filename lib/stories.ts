import { supabase } from "@/lib/supabase";

// ================================================================
// «Сторис» на главной — кружки-актуальное, как в Instagram. Читаем
// анонимным ключом — RLS отдаёт только активные истории и их фото
// (см. migrations/008_promo_codes_and_stories.sql). Запись — только
// из /admin/stories (lib/actions/stories.ts, service-role).
// ================================================================

export type StorySlide = {
  mediaType: "image" | "video";
  /** Фото или ролик (MP4). */
  mediaUrl: string;
  /** Кадр ролика — показываем, пока он грузится или если браузер его не осилит. */
  posterUrl: string | null;
  /** У фото — сколько секунд показывать; у ролика — его длина. */
  durationSeconds: number;
  /** Куда ведёт кнопка на слайде. null — кнопки нет. */
  linkUrl: string | null;
  /** Надпись на кнопке. Пусто при заданной ссылке — покажем «Подробнее». */
  linkLabel: string | null;
};

export type Story = {
  id: string;
  title: string;
  /** Когда историю меняли — по нему просмотренная снова становится новой. */
  updatedAt: string;
  coverImage: string | null;
  items: StorySlide[];
};

export async function getActiveStories(): Promise<Story[]> {
  const { data, error } = await supabase
    .from("stories")
    .select("id, title, cover_image, updated_at, story_items ( image_url, media_type, poster_url, duration_seconds, sort_order, link_url, link_label )")
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
    updated_at: string;
    story_items:
      | {
          image_url: string;
          media_type: string;
          poster_url: string | null;
          duration_seconds: number;
          sort_order: number;
          link_url: string | null;
          link_label: string | null;
        }[]
      | null;
  };

  return ((data ?? []) as unknown as Row[])
    .map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      coverImage: row.cover_image,
      items: (row.story_items ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => ({
          mediaType: item.media_type === "video" ? ("video" as const) : ("image" as const),
          mediaUrl: item.image_url,
          posterUrl: item.poster_url,
          durationSeconds: item.duration_seconds,
          linkUrl: item.link_url,
          linkLabel: item.link_label,
        })),
    }))
    // История без слайдов — нечего показывать, отфильтровываем.
    .filter((story) => story.items.length > 0);
}
