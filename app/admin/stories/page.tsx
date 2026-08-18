import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { listStoriesAdmin } from "@/lib/actions/stories";
import { ArrowRightIcon, EditIcon } from "@/components/ui/Icons";
import { ToggleActiveButton } from "@/components/admin/stories/ToggleActiveButton";
import { DeleteButton } from "@/components/admin/stories/DeleteButton";

export const metadata: Metadata = {
  title: "Сторис — Админка Floria",
};

export const dynamic = "force-dynamic";

export default async function AdminStoriesPage() {
  await requireStaffUser();
  const stories = await listStoriesAdmin();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
            Админка
          </span>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Сторис</h1>
          <p className="mt-2 max-w-lg font-body text-sm text-ink/60">
            Кружки-актуальное под шапкой на главной. Клиент нажимает — открывается полноэкранный
            просмотр фото по порядку.
          </p>
        </div>

        <Link
          href="/admin/stories/new"
          className="flex items-center gap-2 rounded-full bg-gold-500 px-6 py-3.5 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600"
        >
          Добавить историю
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>

      {stories.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-lavender-200 px-6 py-20 text-center">
          <p className="font-display text-lg font-semibold text-ink">Пока нет ни одной истории</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {stories.map((story) => (
            <div
              key={story.id}
              className="flex items-center gap-4 rounded-3xl border border-lavender-100 bg-white p-4"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-lavender-100 bg-lavender-50">
                {story.coverImage ? (
                  <img src={story.coverImage} alt="" className="h-full w-full object-cover" />
                ) : null}
              </span>

              <div className="flex-1">
                <Link href={`/admin/stories/${story.id}/edit`} className="group block">
                  <span className="block font-display text-sm font-semibold text-ink transition group-hover:text-gold-600">
                    {story.title}
                  </span>
                </Link>
                <span className="mt-0.5 block font-body text-xs text-ink/40">
                  {story.itemCount} {story.itemCount === 1 ? "фото" : "фото"}
                </span>
              </div>

              {story.isActive ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 font-body text-xs font-medium text-green-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                  Показана
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-lavender-100 px-3 py-1 font-body text-xs font-medium text-ink/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink/30" aria-hidden="true" />
                  Скрыта
                </span>
              )}

              <div className="flex items-center gap-1">
                <ToggleActiveButton storyId={story.id} isActive={story.isActive} />
                <Link
                  href={`/admin/stories/${story.id}/edit`}
                  aria-label="Редактировать историю"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-100 hover:text-gold-600"
                >
                  <EditIcon className="h-4 w-4" />
                </Link>
                <DeleteButton storyId={story.id} title={story.title} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
