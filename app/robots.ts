import type { MetadataRoute } from "next";
import { CONTACTS } from "@/lib/contacts";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /hero-preview — черновая страница выбора главного блока. На ней
      // же лежит noindex, но запрет здесь экономит обход: без него робот
      // всё равно скачает страницу, чтобы прочитать запрет внутри.
      disallow: ["/admin", "/admin/", "/account", "/api", "/hero-preview"],
    },
    sitemap: `${CONTACTS.siteUrl}/sitemap.xml`,
  };
}
