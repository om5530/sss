export interface SaasStockMovement {
  _id: string; kind: 'opening' | 'adjustment' | 'tracking' | 'sale' | 'production' | 'waste' | 'reservation_return'; before: number | null; after: number | null;
  delta: number | null; productVersion: number; orderId?: string; productionRunId?: string; wasteId?: string; createdAt: string;
}
