export type SaasUsageResource = 'products' | 'materials' | 'recipes' | 'events' | 'orders' | 'productionRuns' | 'materialMovements' | 'wasteEntries' | 'customers';
export interface SaasUsage {
  policy: 'development' | 'subscription-preview';
  usage: Record<SaasUsageResource, { used: number; limit: number }>;
  revisionsPerRecipeLimit: number;
}
