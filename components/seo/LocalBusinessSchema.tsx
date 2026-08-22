import { CONTACTS } from "@/lib/contacts";
import { safeJsonLd } from "@/lib/json-ld";

/**
 * Одна и та же разметка на каждой странице (не только на главной) — так
 * рекомендует сам schema.org для небольшого сайта с одной точкой: не
 * нужно гадать, к какой странице "привязать" бизнес, поисковик просто
 * видит сущность везде одинаково. Значения — из lib/contacts.ts, чтобы
 * не редактировать в двух местах при смене телефона/адреса.
 */
export function LocalBusinessSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Florist",
    name: "Floria",
    image: `${CONTACTS.siteUrl}/logo.png`,
    url: CONTACTS.siteUrl,
    telephone: CONTACTS.phoneHref,
    email: CONTACTS.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: CONTACTS.addressLine,
      addressLocality: CONTACTS.city,
      addressCountry: "RU",
    },
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ],
      opens: "08:00",
      closes: "22:00",
    },
    sameAs: [CONTACTS.telegram],
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }}
    />
  );
}
