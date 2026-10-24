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

/** Search whole families so matching a revision keeps every revision selectable. */
export function searchRecipeGroups(groups: RecipeRevisionGroup[], query: string): RecipeRevisionGroup[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return groups;
  return groups.filter(group => {
    const text = [group.name, ...group.revisions.flatMap(recipe =>
      [recipe.name, recipe.code, recipe.category, recipe.revisionLabel])]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}
