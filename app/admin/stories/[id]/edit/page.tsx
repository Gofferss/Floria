import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffUser } from "@/lib/auth/server";
import { getStoryForEdit } from "@/lib/actions/stories";
import { StoryForm } from "@/components/admin/stories/StoryForm";
import { ArrowRightIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Редактирование истории — Админка Floria",
};

type EditStoryPageProps = {
  params: { id: string };
};

export default async function EditStoryPage({ params }: EditStoryPageProps) {
  await requireStaffUser();

  const story = await getStoryForEdit(params.id);
  if (!story) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <Link
          href="/admin/stories"
          className="inline-flex items-center gap-1.5 font-body text-sm text-ink/50 transition hover:text-ink"
        >
          <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
          К сторис
        </Link>

        <h1 className="mt-3 font-display text-2xl font-bold text-ink sm:text-3xl">{story.title}</h1>
      </div>

      <StoryForm story={story} />
    </div>
  );
}
