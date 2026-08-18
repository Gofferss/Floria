"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackEvent } from "@/lib/analytics/track";

type TrackedLinkProps = ComponentProps<typeof Link> & { eventTarget: string };

/**
 * Обычный next/link + отправка клика в метрики — нужен как отдельный
 * клиентский компонент, потому что сам Link часто используется внутри
 * серверных компонентов (Hero и т.п.), где обработчик onClick напрямую
 * не повесить.
 */
export function TrackedLink({ eventTarget, onClick, ...props }: TrackedLinkProps) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        trackEvent("button_click", eventTarget);
        onClick?.(e);
      }}
    />
  );
}
