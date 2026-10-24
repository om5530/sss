import type { BakeryRecipe } from '../../../../core/models/bakery.model';

export interface RecipeRevisionGroup {
  id: string;
  name: string;
  revisions: BakeryRecipe[];
}

export function groupRecipeRevisions(recipes: BakeryRecipe[]): RecipeRevisionGroup[] {
  const families = new Map<string, BakeryRecipe[]>();
  for (const recipe of recipes) {
    const id = recipe.revisionFamilyId || recipe._id;
    const revisions = families.get(id) || [];
    revisions.push(recipe);
    families.set(id, revisions);
  }
  return [...families].map(([id, revisions]) => {
    revisions.sort((a, b) => (a.revisionNumber || 1) - (b.revisionNumber || 1) || a._id.localeCompare(b._id));
    return { id, name: (revisions.find(r => r._id === id) || revisions[0]).name, revisions };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

export function selectRecipeRevision(group: RecipeRevisionGroup, selectedId?: string): BakeryRecipe {
  return group.revisions.find(r => r._id === selectedId)
    || group.revisions.find(r => r.productId)
    || group.revisions[group.revisions.length - 1];
}
