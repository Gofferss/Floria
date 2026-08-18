import Link from "next/link";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { BlogCard } from "@/components/blog/BlogCard";
import { getPublishedPosts } from "@/lib/blog";

export async function BlogPreview() {
  const posts = (await getPublishedPosts()).slice(0, 3);

  // Пока не опубликовано ни одной статьи — секция на главной просто не
  // рендерится, а не показывает три пустых карточки-заглушки без ссылок.
  if (posts.length === 0) return null;

  return (
    <section className="relative py-10 sm:py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-10 lg:mb-14">
          <div>
            <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
              Журнал Floria
            </span>
            <h2 className="mt-1.5 font-display text-2xl font-bold text-ink sm:mt-2 sm:text-3xl lg:text-4xl">
              Сезонные советы и новости
            </h2>
          </div>
          <Link
            href="/blog"
            className="inline-flex items-center gap-1 font-display text-sm font-medium text-ink/70 transition hover:text-gold-600"
          >
            Все статьи
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 lg:gap-8">
          {posts.map((post) => (
            <BlogCard key={post.id} post={post} />
          ))}
        </div>
      </div>
    </section>
  );
}