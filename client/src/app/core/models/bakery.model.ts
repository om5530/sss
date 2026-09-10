export type MaterialType = 'ingredient' | 'packaging' | 'resource' | 'labour';

export interface BakeryMaterial {
  _id: string;
  name: string;
  code?: string;
  type: MaterialType;
  category: string;
  baseUom: string;
  densityGramPerMl?: number;
  packQuantity: number;
  packUom: string;
  purchasePrice: number;
  effectiveUnitCost: number;
  currentStock: number;
  allocatedStock?: number;
  available?: number;
  minimumStock: number;
  reorderLevel?: number;
  supplierName?: string;
  brand?: string;
  description?: string;
  image?: string;
  leadTimeDays?: number;
  notes?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RecipeComponent {
  _id?: string;
  componentType: 'material' | 'sub_recipe' | 'other';
  materialId?: string | BakeryMaterial;
  subRecipeId?: string | BakeryRecipe;
  name: string;
  category?: string;
  itemType: 'ingredient' | 'sub_recipe' | 'packaging' | 'resource' | 'labour' | 'other';
  workers?: number;
  quantity: number;
  uom: string;
  scalingMethod: 'linear' | 'stepped' | 'fixed';
  capacityPerCycle?: number;
  cycleMinutes?: number;
  unitCost?: number;
  totalCost?: number;
}

export interface BakeryRecipe {
  options?: { name: string; components: RecipeComponent[] }[];
  overheadPerBatch?: number;
  expectedLossPercent?: number;
  costingError?: string;
  _id: string;
  name: string;
  code?: string;
  category: string;
  version?: number;
  isSubRecipe?: boolean;
  baseBatchUnits: number;
  yieldQuantity: number;
  yieldUom: string;
  finishedWeightGrams?: number;
  components: RecipeComponent[];
  ingredientCost: number;
  packagingCost: number;
  labourCost: number;
  resourceCost: number;
  totalBatchCost: number;
  costPerUnit: number;
  targetMarkupPercent: number;
  suggestedSellingPrice: number;
  manualSellingPrice?: number;
  instructions?: string[];
  notes?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScaledComponent {
  materialId?: string;
  subRecipeId?: string;
  name: string;
  category: string;
  itemType: string;
  scalingMethod?: string;
  cycles?: number;
  quantity: number;
  uom: string;
  unitCost: number;
  totalCost: number;
}

export interface ScaledRecipeResult {
  targetUnits: number;
  recipeName: string;
  yieldUom: string;
  ingredientCost: number;
  packagingCost: number;
  labourCost: number;
  resourceCost: number;
  totalCost: number;
  costPerUnit: number;
  suggestedSellingPrice: number;
  profit: number;
  marginPercent: number;
  components: ScaledComponent[];
}

export interface AggregatedIngredient {
  materialId?: string;
  name: string;
  category: string;
  quantity: number;
  uom: string;
  unitCost: number;
  totalCost: number;
  currentStock: number;
  shortage: number;
  packsNeeded: number;
  packFormat: string;
  supplierName?: string;
  estimatedSpend: number;
}

export interface MultiProductResult {
  ingredients: AggregatedIngredient[];
  packaging: ScaledComponent[];
  labour: ScaledComponent[];
  resources: ScaledComponent[];
  totalCost: number;
  ingredientCost: number;
  packagingCost: number;
  labourCost: number;
  resourceCost: number;
  markupPercent: number;
  suggestedSellingPrice: number;
  profit: number;
  marginPercent: number;
}

export interface BakeryWaste {
  _id: string;
  materialId?: string;
  materialName: string;
  type: string;
  quantity: number;
  uom: string;
  unitCost: number;
  totalCostLost: number;
  reason: string;
  date: string;
  notes?: string;
}

export interface CostingSheet {
  _id?: string;
  code?: string;
  type: 'costing_sheet' | 'production_plan' | 'batch';
  referenceName: string;
  customerName?: string;
  productionDate?: string;
  items: {
    recipeId: string;
    recipeName: string;
    quantity: number;
    yieldUom: string;
    totalCost: number;
  }[];
  totalCost: number;
  markupPercent: number;
  marginPercent: number;
  suggestedSellingPrice: number;
  status: string;
  notes?: string;
  createdAt?: string;
}
