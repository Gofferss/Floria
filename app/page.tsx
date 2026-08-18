import { Hero } from "@/components/home/Hero";
import { StoriesRail } from "@/components/home/StoriesRail";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { BlogPreview } from "@/components/home/BlogPreview";

export default function HomePage() {
  return (
    <>
      <Hero />
      <StoriesRail />

      <div className="bg-lavender-50">
        <CategoryGrid />
        <BlogPreview />
      </div>
    </>
  );
}
