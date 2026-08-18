// ================================================================
// Клиентский helper для отправки анонимных событий (клик по кнопке,
// просмотр товара...) — см. migrations/009_analytics_events.sql за
// объяснением, почему это не требует куки/согласия. sendBeacon —
// потому что часто вызывается прямо перед переходом по ссылке
// (клик по кнопке "В каталог"), а обычный fetch может не успеть
// уйти до того, как браузер начнёт выгружать страницу.
// ================================================================

export function trackEvent(eventType: string, target: string): void {
  if (typeof window === "undefined") return;

  try {
    const payload = JSON.stringify({ eventType, target, pagePath: window.location.pathname });

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/analytics/track", blob);
      return;
    }

    fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Метрика не должна ронять взаимодействие пользователя ни при каких обстоятельствах.
  }
}
