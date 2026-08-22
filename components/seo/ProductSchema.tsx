import { CONTACTS } from "@/lib/contacts";
import type { AvailabilityMode } from "@/lib/products";
import { safeJsonLd } from "@/lib/json-ld";

const SCHEMA_AVAILABILITY: Record<AvailabilityMode, string> = {
  in_stock: "https://schema.org/InStock",
  made_to_order: "https://schema.org/PreOrder",
};

export function ProductSchema({
  name,
  description,
  slug,
  images,
  price,
  availabilityMode,
}: {
  name: string;
  description: string;
  slug: string;
  images: string[];
  price: number;
  availabilityMode: AvailabilityMode;
}) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    // Пустой массив — не то же самое, что "поля нет": у товаров без фото
    // (пока не дошли руки загрузить) не шлём image вовсе, а не [] — так
    // спокойнее для валидаторов вроде Google Rich Results Test.
    ...(images.length > 0 ? { image: images } : {}),
    offers: {
      "@type": "Offer",
      url: `${CONTACTS.siteUrl}/catalog/${slug}`,
      priceCurrency: "RUB",
      price,
      availability: SCHEMA_AVAILABILITY[availabilityMode],
    },
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }}
    />
  );
}
