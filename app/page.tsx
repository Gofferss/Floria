import { Hero } from "@/components/home/Hero";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { BlogPreview } from "@/components/home/BlogPreview";

export default function HomePage() {
  return (
    <>
      {/* Истории переехали внутрь Hero — под текст и фото букета, как на
          макете. Отдельной секции между хиро и категориями больше нет. */}
      <Hero />

      {/* Категории несут собственный градиент (в тон хиро), поэтому общей
          заливки на обёртке больше нет — она перебивала бы его ровным цветом.
          Блог остаётся на светлой лавандовой подложке, как и был. */}
      <CategoryGrid />

      <div className="bg-lavender-50">
        <BlogPreview />
      </div>
    </>
  );
}
