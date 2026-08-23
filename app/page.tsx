import { Hero } from "@/components/home/Hero";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { BlogPreview } from "@/components/home/BlogPreview";

export default function HomePage() {
  return (
    // Один градиент на всю главную (.home-canvas в globals.css). До этого
    // фон был у каждой секции свой, и на стыках проступал шов: блок
    // заканчивался белым, а следующий снова начинался лавандовым. Сами
    // секции теперь прозрачные и просто лежат на общем полотне.
    <div className="home-canvas relative overflow-hidden">
      {/* Истории переехали внутрь Hero — под текст и фото букета, как на
          макете. Отдельной секции между хиро и категориями больше нет. */}
      <Hero />
      <CategoryGrid />
      <BlogPreview />
    </div>
  );
}
