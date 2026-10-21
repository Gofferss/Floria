import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ArrowRightIcon, EditIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Статьи блога — Админка Floria",
};

// Данные приватные и должны быть всегда актуальны для того, кто только
// что опубликовал статью — без ISR-кэша, как на публичной /blog.
export const dynamic = "force-dynamic";

type AdminPost = {
  id: string;
  title: string;
  slug: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export default async function AdminBlogListPage() {
  await requireStaffUser();

  const { data, error } = await getSupabaseAdmin()
    .from("blog_posts")
    .select("id, title, slug, is_published, published_at, created_at");

  if (error) console.error("[AdminBlogListPage]", error.message);

  // Сортируем по "содержательной" дате (published_at, иначе created_at), а
  // не всегда по created_at — иначе перенесённые задним числом статьи
  // (см. поле "Дата публикации" в форме) окажутся не там, где ожидает автор:
  // created_at у них — момент импорта в базу, а не исходная дата статьи.
  const posts = ((data ?? []) as AdminPost[]).sort(
    (a, b) =>
      new Date(b.published_at ?? b.created_at).getTime() -
      new Date(a.published_at ?? a.created_at).getTime()
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
            Админка
          </span>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">
            Статьи блога
          </h1>
        </div>

        <Link
          href="/admin/blog/new"
          className="flex items-center gap-2 rounded-full bg-gold-500 px-6 py-3.5 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-gold-600"
        >
          Написать статью
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-lavender-200 px-6 py-20 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            Пока нет ни одной статьи
          </p>
          <p className="mt-1 max-w-sm mx-auto font-body text-sm text-ink/50">
            Нажмите «Написать статью», чтобы создать первую публикацию.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-lavender-100 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-lavender-100 bg-lavender-50/60">
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Название
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Дата
                  </th>
                  <th className="px-5 py-3.5 font-display text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Статус
                  </th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr
                    key={post.id}
                    className="border-b border-lavender-50 transition last:border-0 hover:bg-lavender-50/50"
                  >
                    <td className="px-5 py-4">
                      <Link href={`/admin/blog/${post.id}/edit`} className="group block">
                        <span className="block font-display text-sm font-semibold text-ink transition group-hover:text-gold-600">
                          {post.title}
                        </span>
                        <span className="mt-0.5 block font-body text-xs text-ink/40">
                          /blog/{post.slug}
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-4 font-body text-sm text-ink/60">
                      {dateFormatter.format(new Date(post.published_at ?? post.created_at))}
                    </td>
                    <td className="px-5 py-4">
                      {post.is_published ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 font-body text-xs font-medium text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                          Опубликовано
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-lavender-100 px-3 py-1 font-body text-xs font-medium text-ink/60">
                          <span className="h-1.5 w-1.5 rounded-full bg-ink/30" aria-hidden="true" />
                          Черновик
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/admin/blog/${post.id}/edit`}
                        aria-label="Редактировать статью"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition hover:bg-lavender-100 hover:text-gold-600"
                      >
                        <EditIcon className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
