import type { MetadataRoute } from "next";
import { getProductSlugs } from "@/lib/products";
import { getPublishedSlugs } from "@/lib/blog";
import { CONTACTS } from "@/lib/contacts";

// Раз в час достаточно — каталог и блог не меняются ежеминутно, а лишний
// обход БД на каждый запрос робота смысла не имеет.
export const revalidate = 3600;

const STATIC_PAGES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, changeFrequency: "daily" },
  { path: "/catalog", priority: 0.9, changeFrequency: "daily" },
  { path: "/about", priority: 0.5, changeFrequency: "monthly" },
  { path: "/delivery", priority: 0.6, changeFrequency: "monthly" },
  { path: "/blog", priority: 0.7, changeFrequency: "daily" },
  { path: "/contacts", priority: 0.5, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.1, changeFrequency: "yearly" },
  { path: "/consent", priority: 0.1, changeFrequency: "yearly" },
  { path: "/offer", priority: 0.1, changeFrequency: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = CONTACTS.siteUrl;
  const now = new Date();

  const [productSlugs, blogSlugs] = await Promise.all([getProductSlugs(), getPublishedSlugs()]);

  const staticEntries: MetadataRoute.Sitemap = STATIC_PAGES.map((page) => ({
    url: `${base}${page.path}`,
    lastModified: now,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));

  const productEntries: MetadataRoute.Sitemap = productSlugs.map((slug) => ({
    url: `${base}/catalog/${slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const blogEntries: MetadataRoute.Sitemap = blogSlugs.map((slug) => ({
    url: `${base}/blog/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticEntries, ...productEntries, ...blogEntries];
}
