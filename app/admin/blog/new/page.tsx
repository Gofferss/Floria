import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffUser } from "@/lib/auth/server";
import { BlogPostForm } from "@/components/admin/blog/BlogPostForm";
import { ArrowRightIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Новая статья — Админка Floria",
};

export default async function NewBlogPostPage() {
  await requireStaffUser();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mb-8">
        <Link
          href="/admin/blog"
          className="inline-flex items-center gap-1.5 font-body text-sm text-ink/50 transition hover:text-ink"
        >
          <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
          К списку статей
        </Link>

        <h1 className="mt-3 font-display text-2xl font-bold text-ink sm:text-3xl">
          Новая статья
        </h1>
      </div>

      <BlogPostForm />
    </div>
  );
}
