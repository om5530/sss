export interface SaasProductionInput {
  productId: string; revisionId: string; expectedProductVersion: number; batches: number; note: string; inventoryFingerprint?: string;
}
export interface SaasProductionSave extends SaasProductionInput { confirmed: true; idempotencyKey: string; }
export interface SaasProductionQuote {
  productId: string; recipeId: string; revisionId: string; productName: string; recipeName: string;
  revisionNumber: number; yieldPieces: number; batches: number; producedPieces: number;
  stockBefore: number; stockAfter: number; productVersion: number; batchCostPaise: string; totalCostPaise: string;
  materialUsage?: { materialId: string; materialName: string; unit: string; quantity: string; before: string; after: string; stockVersion: number; estimatedCostPaise: string }[];
  inventoryFingerprint?: string;
  overheadPaise: string; ingredients: { materialId: string; name: string; quantity: string; uom: string; costPaise: string }[]; note: string;
}
export interface SaasProductionRun extends SaasProductionQuote { _id: string; createdAt: string; }
export interface PendingProduction { productName: string; producedPieces: number; input: SaasProductionSave; }
