export interface SaasWasteInput { productId: string; eventId: string | null; quantity: number; expectedProductVersion: number; reason: string; }
export interface SaasWasteSave extends SaasWasteInput { confirmed: true; idempotencyKey: string; }
export interface SaasWasteQuote {
  productId: string; productName: string; eventId: string | null; eventName: string; quantity: number;
  stockBefore: number; stockAfter: number; productVersion: number; revisionId: string | null; revisionNumber: number | null;
  batchCostPaise: string | null; yieldPieces: number | null; estimatedCostPaise: string | null; reason: string;
}
export interface SaasWasteEntry extends SaasWasteQuote { _id: string; createdAt: string; }
export interface PendingWaste { productName: string; eventName: string; input: SaasWasteSave; }
