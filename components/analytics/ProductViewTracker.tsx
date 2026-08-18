"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics/track";

/** Ничего не рендерит — только фиксирует просмотр карточки товара при монтировании. */
export function ProductViewTracker({ productName }: { productName: string }) {
  useEffect(() => {
    trackEvent("product_view", productName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productName]);

  return null;
}
