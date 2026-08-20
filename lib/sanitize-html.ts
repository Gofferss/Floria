import sanitizeHtml from "sanitize-html";

// ================================================================
// Санитизация HTML статей блога перед записью в БД. content раньше
// сохранялся и рендерился (dangerouslySetInnerHTML, см. app/blog/[slug])
// как есть — теоретически безопасно, пока писать могут только сотрудники
// (RLS), но реально это значит, что скомпрометированный или
// недобросовестный staff-аккаунт мог вставить <script> и получить XSS
// у КАЖДОГО посетителя публичной страницы статьи (найдено при аудите
// 2026-08-20). Allowlist — ровно то, что документировано в самой форме
// редактора (components/admin/blog/BlogPostForm.tsx: "Базовый HTML:
// <h2>, <p>, <ul>, <li>, <strong>, <a>" + <img> через кнопку вставки
// фото) плюс несколько столь же безобидных соседей по смыслу (h3, ol,
// em, br, blockquote) — не расширение возможностей редактора, а тот же
// уровень риска, что уже заявлен.
// ================================================================

const ALLOWED_TAGS = [
  "p",
  "br",
  "h2",
  "h3",
  "strong",
  "em",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "img",
];

export function sanitizeBlogContent(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      // target="_blank" без rel="noopener noreferrer" открывает reverse
      // tabnabbing — новая вкладка получает доступ к window.opener исходной
      // страницы. Простановка модели безопаснее, чем доверять её сотруднику.
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  });
}
