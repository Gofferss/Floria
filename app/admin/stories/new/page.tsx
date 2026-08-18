import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { listStoriesAdmin } from "@/lib/actions/stories";
import { StoryForm } from "@/components/admin/stories/StoryForm";

export const metadata: Metadata = {
  title: "Новая история — Админка Floria",
};

export default async function NewStoryPage() {
  await requireStaffUser();
  const existing = await listStoriesAdmin();
  const nextSortOrder = existing.length > 0 ? Math.max(...existing.map((s) => s.sortOrder)) + 10 : 10;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Сторис
        </span>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Новая история</h1>
      </div>

      <StoryForm nextSortOrder={nextSortOrder} />
    </div>
  );
}
