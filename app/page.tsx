import { Hero } from "@/components/home/Hero";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { BlogPreview } from "@/components/home/BlogPreview";

export default function HomePage() {
  return (
    <>
      <Hero />

      <div className="bg-lavender-50">
        <CategoryGrid />
        <BlogPreview />
      </div>
    </>
  );
}
