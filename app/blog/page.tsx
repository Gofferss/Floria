import type { Metadata } from "next";
import { BlogCard } from "@/components/blog/BlogCard";
import { BloomMark } from "@/components/ui/BloomMark";
import { getPublishedPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Журнал Floria — советы флористов и новости студии",
  description: "Статьи студии цветов Floria: уход за букетом, сезонные тренды и новости.",
};

// Блог обновляется вручную и нечасто — секунда лишней задержки на
// перегенерацию раз в несколько минут не критична, а нагрузку на БД
// снимает полностью.
export const revalidate = 300;

export default async function BlogPage() {
  const posts = await getPublishedPosts();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-10 lg:mb-14">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          Журнал Floria
        </span>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">
          Сезонные советы и новости
        </h1>
        <p className="mt-3 max-w-xl font-body text-base leading-relaxed text-ink/60">
          Пишем о том, что знаем сами: как продлить жизнь букету, какие цветы
          сейчас в сезоне и что нового в студии.
        </p>
      </div>

      {posts.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-lavender-200 px-6 py-20 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-lavender-100 to-gold-50 text-lavender-400">
            <BloomMark className="h-9 w-9" />
          </div>
          <div>
            <p className="font-display text-lg font-semibold text-ink">
              Здесь скоро появятся новости студии
            </p>
            <p className="mt-1 max-w-sm font-body text-sm text-ink/50">
              Мы готовим первые статьи — загляните чуть позже.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {posts.map((post) => (
            <BlogCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
