import type { MetadataRoute } from "next";
import { CONTACTS } from "@/lib/contacts";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/admin/", "/account", "/api"],
    },
    sitemap: `${CONTACTS.siteUrl}/sitemap.xml`,
  };
}
