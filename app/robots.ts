import type { MetadataRoute } from "next";
import { CONTACTS } from "@/lib/contacts";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /uchet — рабочее приложение студии, в поиске ему делать нечего.
      disallow: ["/admin", "/admin/", "/account", "/api", "/uchet"],
    },
    sitemap: `${CONTACTS.siteUrl}/sitemap.xml`,
  };
}
