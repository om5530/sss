import { SaasUom } from './saas-recipe.model';
export interface SaasInventoryInput {
  materialId: string; kind: 'opening' | 'receipt' | 'waste' | 'count'; quantity: string; uom: SaasUom;
  expectedMaterialVersion: number; expectedStockVersion: number; reason: string;
}
export interface SaasInventorySave extends SaasInventoryInput { confirmed: true; idempotencyKey: string; }
export interface SaasMaterialStock {
  _id: string; materialId: string; name: string; unit: SaasUom; onHand: string; version: number; materialVersion: number | null;
}
export interface SaasMaterialMovement {
  _id: string; materialId: string; materialName: string; materialVersion?: number; kind: 'opening' | 'receipt' | 'waste' | 'count' | 'production';
  unit: SaasUom; quantity: string; before: string | null; after: string; estimatedCostPaise: string; stockVersion: number;
  reason: string; productionRunId?: string; createdAt: string;
}
export type SaasInventoryQuote = Omit<SaasMaterialMovement, '_id' | 'createdAt'>;
export interface PendingInventory { materialName: string; input: SaasInventorySave; }
