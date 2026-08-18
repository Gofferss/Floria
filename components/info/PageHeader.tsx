import { AmbientGlow } from "@/components/ui/AmbientGlow";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
};

/** Единая шапка для информационных страниц (/about, /delivery, /contacts) */
export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <header className="relative overflow-hidden bg-gradient-to-b from-lavender-100 to-lavender-50">
      <AmbientGlow />

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-gold-600">
          {eyebrow}
        </span>
        <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-ink sm:text-4xl lg:text-[42px]">
          {title}
        </h1>
        {description && (
          <p className="mt-4 max-w-2xl font-body text-base leading-relaxed text-ink/70 sm:text-lg">
            {description}
          </p>
        )}
      </div>
    </header>
  );
}
