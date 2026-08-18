import { getActiveStories } from "@/lib/stories";
import { StoriesRailClient } from "@/components/home/StoriesRailClient";

/** Ничего не рендерит, пока в /admin/stories не добавят хотя бы одну активную историю. */
export async function StoriesRail() {
  const stories = await getActiveStories();
  if (stories.length === 0) return null;

  return <StoriesRailClient stories={stories} />;
}
