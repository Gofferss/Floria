// Временные данные для верстки. На этапе интеграции с бэкендом
// (Шаг 3) заменяются на запросы к Supabase (`product_categories`, `blog_posts`).

export type CategoryCard = {
  slug: string;
  title: string;
  subtitle: string;
  /** Путь к файлу в /public — см. README, раздел "Изображения главной страницы" */
  image: string;
};

export const categories: CategoryCard[] = [
  {
    slug: "tulpany-k-8-marta",
    title: "Тюльпаны к 8 марта",
    subtitle: "Свежая срезка, сезонные сборы",
    image: "/category-tulips.jpg",
  },
  {
    slug: "avtorskie-bukety",
    title: "Авторские букеты",
    subtitle: "Флористика от студии Floria",
    image: "/category-signature.jpg",
  },
  {
    slug: "svadebnaya-floristika",
    title: "Свадебная флористика",
    subtitle: "Букет невесты, оформление зала",
    image: "/category-wedding.jpg",
  },
  {
    slug: "cvetochnaya-podpiska",
    title: "Цветочная подписка",
    subtitle: "Свежий букет каждую неделю",
    image: "/category-subscription.jpg",
  },
];
