import type { RecipeComponent } from '../../../../core/models/bakery.model';

/** An explicitly edited resource quantity is usage for one recipe batch. */
export function setRecipeComponentQuantity(component: RecipeComponent, quantity: number) {
  component.quantity = quantity;
  if (component.componentType === 'material' && component.itemType === 'resource') {
    component.scalingMethod = 'linear';
  }
}
