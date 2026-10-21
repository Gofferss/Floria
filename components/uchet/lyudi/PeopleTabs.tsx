import Link from "next/link";
import { ui } from "@/components/uchet/ui";

/** Вкладки раздела «Сотрудники»: люди и входы — отдельно, деньги — отдельно. */
export function PeopleTabs({ active }: { active: "people" | "pay" }) {
  const tabs = [
    { key: "people", href: "/uchet/lyudi", label: "Люди и входы" },
    { key: "pay", href: "/uchet/lyudi/zarplata", label: "Зарплата" },
  ] as const;
  return (
    <nav className="flex gap-2" aria-label="Разделы">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={active === t.key ? "page" : undefined} className={`${ui.chip} ${active === t.key ? ui.chipOn : ui.chipOff}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
