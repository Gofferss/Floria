// Барьер модуля: снаружи (lib/customer-sync.ts, app/api/orders/route.ts)
// импортируют по-прежнему из "@/lib/posiflora" — то, что раньше было
// одним файлом-моком, теперь папка с реальной логикой, но публичный
// контракт не изменился ни на один символ.

export {
  findOrCreatePosifloraClient,
  getPosifloraClientBalance,
  findPosifloraClientByPhone,
  type FindOrCreatePosifloraClientInput,
  type PosifloraClient,
} from "./customers";

export {
  createPosifloraOrder,
  type PosifloraOrderInput,
  type PosifloraOrderItemInput,
  type PosifloraOrderResult,
} from "./orders";

export { syncPosifloraCatalog, recomputeProductAvailability, type CatalogSyncSummary } from "./catalog";

export { searchInventoryItems, getAllAvailableInventoryItemIds, type InventoryItemOption } from "./inventory";