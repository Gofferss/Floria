// ================================================================
// Пускает ли Telegram нашего бота к виджетам.
//
// В движке виджетов (QuickJS внутри приложений Telegram) нашли уязвимости,
// вплоть до выполнения кода без нажатия; Telegram их закрыл и, судя по
// отчётам разработчиков, разрешил отправку виджетов только ботам из своего
// списка. Остальным sendWidget отвечает INPUT_MEDIA_WIDGET_NOT_ALLOWED —
// 13.11.2026 наш бот виджет отправил, 14.11 уже нет.
//
// Чтобы не стучаться в закрытую дверь при каждом заказе, после такого
// ответа шесть часов виджеты не пробуем — сразу обычные сообщения. Пустят
// снова — первая же попытка после паузы пройдёт, и всё заработает само.
// ================================================================

const PAUSE_MS = 6 * 60 * 60 * 1000;
let blockedUntil = 0;

export function widgetsLikelyAllowed(): boolean {
  return Date.now() >= blockedUntil;
}

/** Запомнить отказ Telegram, если это именно «виджеты нельзя». */
export function noteWidgetFailure(error: unknown): void {
  const text = error instanceof Error ? error.message : String(error);
  if (/WIDGET_NOT_ALLOWED/i.test(text)) blockedUntil = Date.now() + PAUSE_MS;
}
