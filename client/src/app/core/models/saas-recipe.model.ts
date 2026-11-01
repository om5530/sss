export type SaasUom = 'mg' | 'g' | 'kg' | 'ml' | 'L' | 'piece' | 'dozen' | 'packet' | 'box' | 'minute' | 'hour';
export interface SaasMaterialInput {
  name: string; type?: 'ingredient' | 'packaging' | 'resource' | 'labour';
  packQuantity: string; packUom: SaasUom; purchasePricePaise: number; active?: boolean;
}
export interface SaasMaterial extends SaasMaterialInput { _id: string; type: NonNullable<SaasMaterialInput['type']>; active: boolean; version: number; }
export interface SaasIngredientInput { materialId: string; expectedVersion: number; quantity: string; uom: SaasUom; }
export interface SaasRevisionInput { yieldPieces: number; label?: string; notes?: string; overheadPaise?: number; ingredients: SaasIngredientInput[]; }
export interface SaasRecipe { _id: string; name: string; category: string; archived: boolean; version: number; latestRevisionNumber: number; }
export interface SaasRecipeRevision {
  _id: string; recipeId: string; revisionNumber: number; yieldPieces: number; label: string; notes: string;
  overheadPaise: number; batchCostPaise: string; unitCostPaise: string;
  ingredients: { materialId: string; materialVersion: number; name: string; type: string; quantity: string; uom: SaasUom; packQuantity: string; packUom: SaasUom; purchasePricePaise: number; costPaise: string; }[];
}
export interface SaasRecipeDetail { recipe: SaasRecipe; revisions: SaasRecipeRevision[]; nextBefore: number | null; }
export interface SaasRecipeSave { recipe: SaasRecipe; revision: SaasRecipeRevision; }
export interface SaasItemsPage<T> { items: T[]; nextCursor: string | null; }
