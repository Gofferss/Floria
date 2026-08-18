import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { PhotoCarousel } from "@/components/blog/PhotoCarousel";
import { formatPublishedDate, getPostBySlug, getPublishedSlugs } from "@/lib/blog";

type ArticlePageProps = {
  params: { slug: string };
};

// Блог обновляется вручную и нечасто — см. app/blog/page.tsx.
export const revalidate = 300;

export async function generateStaticParams() {
  const slugs = await getPublishedSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const post = await getPostBySlug(params.slug);
  if (!post) return {};

  return {
    title: post.seoTitle || `${post.title} — Floria`,
    description: post.seoDescription || post.excerpt || undefined,
    openGraph: {
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.excerpt || undefined,
      type: "article",
      ...(post.publishedAt ? { publishedTime: post.publishedAt } : {}),
      ...(post.coverImage ? { images: [post.coverImage] } : {}),
    },
  };
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const post = await getPostBySlug(params.slug);
  if (!post) notFound();

  return (
    <article>
      <header className="relative overflow-hidden bg-gradient-to-b from-lavender-100 to-lavender-50">
        <AmbientGlow />

        <div className="relative mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
          <nav className="mb-6 flex flex-wrap items-center gap-2 font-body text-sm text-ink/50">
            <Link href="/blog" className="transition hover:text-gold-600">
              Журнал
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink/80">{post.title}</span>
          </nav>

          <h1 className="font-display text-3xl font-bold leading-tight text-ink sm:text-4xl lg:text-[42px]">
            {post.title}
          </h1>

          {post.publishedAt && (
            <time dateTime={post.publishedAt} className="mt-5 block font-body text-sm text-ink/50">
              {formatPublishedDate(post.publishedAt)}
            </time>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="relative -mt-4 aspect-[16/9] overflow-hidden rounded-3xl bg-gradient-to-br from-lavender-200 to-lavender-50">
          {post.galleryImages.length > 0 ? (
            <PhotoCarousel images={post.galleryImages} alt={post.title} />
          ) : post.coverImage ? (
            <Image
              src={post.coverImage}
              alt={post.title}
              fill
              priority
              sizes="(min-width: 768px) 700px, 100vw"
              className="object-cover"
            />
          ) : (
            <PhotoPlaceholder className="absolute inset-0 h-full w-full" />
          )}
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        {post.excerpt && (
          <p className="font-body text-lg leading-relaxed text-ink/70">{post.excerpt}</p>
        )}

        {/*
          content — HTML из blog_posts.content, писать в это поле пока
          может только is_staff() (RLS из миграции 000). dangerouslySetInnerHTML
          безопасен в этих рамках; как только появится админка — редактор
          должен либо санитизировать HTML на входе, либо быть WYSIWYG с
          ограниченным набором тегов, а не голым textarea.
        */}
        <div
          className="prose prose-img:rounded-2xl mt-6"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </div>
    </article>
  );
}
