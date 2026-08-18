// ================================================================
// Заказы — ПОКА ОСТАЮТСЯ МОКОМ. Не входили в сегодняшний план (там
// были только задачи 1-3: поиск/создание клиента и синхронизация
// бонусов, всё это — про Customers API). Реальная интеграция заказов
// требует ещё одной вещи, которой у нас пока нет: наш каталог
// (lib/products.ts) не синхронизирован с реальными inventory-items
// Posiflora, а без их ID нельзя собрать order-lines в формате, который
// ожидает POST /v1/orders. Это отдельная задача синхронизации каталога,
// не просто ещё одна функция здесь.
// ================================================================

type MockClientRecord = {
  posifloraClientId: string;
  bonusBalance: number;
};

const mockClientStore = new Map<string, MockClientRecord>();

export type PosifloraOrderItemInput = {
  name: string;
  quantity: number;
  price: number;
};

export type PosifloraOrderInput = {
  orderNumber: string;
  posifloraClientId: string | null;
  customerName: string;
  customerPhone: string;
  items: PosifloraOrderItemInput[];
  bonusUsed: number;
  /** Наш кэш баланса на момент заказа — точка отсчёта для мок-арифметики */
  currentBonusBalance: number;
};

export type PosifloraOrderResult = {
  posifloraOrderId: string | null;
  bonusEarned: number;
  /** Баланс клиента в Posiflora ПОСЛЕ проведения заказа (списание + начисление) */
  bonusBalanceAfter: number;
};

/**
 * Мок интеграции с Posiflora. Имитирует создание заказа в кассовой системе,
 * списание использованных бонусов и начисление новых (условные 5% от суммы
 * товаров).
 */
export async function createPosifloraOrder(
  input: PosifloraOrderInput
): Promise<PosifloraOrderResult> {
  await simulateNetworkDelay();

  const itemsTotal = input.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const bonusEarned = Math.round(itemsTotal * 0.05);
  const bonusBalanceAfter = Math.max(0, input.currentBonusBalance - input.bonusUsed + bonusEarned);

  if (input.posifloraClientId) {
    for (const [key, record] of mockClientStore) {
      if (record.posifloraClientId === input.posifloraClientId) {
        mockClientStore.set(key, { ...record, bonusBalance: bonusBalanceAfter });
        break;
      }
    }
  }

  return {
    posifloraOrderId: `POSI-${Date.now().toString(36).toUpperCase()}`,
    bonusEarned,
    bonusBalanceAfter,
  };
}

function simulateNetworkDelay(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
