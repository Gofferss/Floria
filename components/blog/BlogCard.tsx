import Image from "next/image";
import Link from "next/link";
import { BotanicalPattern } from "@/components/ui/BotanicalPattern";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { formatPublishedDate, type BlogPost } from "@/lib/blog";

export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-lavender-100 bg-white transition hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-lavender-200 to-lavender-50">
        {post.coverImage ? (
          <Image
            src={post.coverImage}
            alt={post.title}
            fill
            sizes="(min-width: 1024px) 380px, (min-width: 640px) 45vw, 90vw"
            className="object-cover"
          />
        ) : (
          // Пока обложка не загружена (Storage-бакет готов, но админки
          // ещё нет) — тот же паттерн-заглушка, что и у каталога.
          <BotanicalPattern className="absolute inset-0 h-full w-full text-white/70" />
        )}
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-6">
        {post.publishedAt && (
          <span className="font-display text-[11px] font-semibold uppercase tracking-wide text-gold-600 sm:text-xs">
            {formatPublishedDate(post.publishedAt)}
          </span>
        )}

        <h3 className="mt-2 font-display text-base font-semibold leading-snug text-ink line-clamp-2 sm:mt-3 sm:text-lg">
          {post.title}
        </h3>

        {post.excerpt && (
          <p className="mt-1.5 font-body text-sm leading-relaxed text-ink/60 line-clamp-3 sm:mt-2">
            {post.excerpt}
          </p>
        )}

        <span className="mt-3 inline-flex items-center gap-1 font-display text-sm font-medium text-gold-600 transition group-hover:gap-2 sm:mt-4">
          Читать статью
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}
