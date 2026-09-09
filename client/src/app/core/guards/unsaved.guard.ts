import { CanDeactivateFn } from '@angular/router';

export const unsavedGuard: CanDeactivateFn<{ canLeave: () => boolean }> = (component) => component.canLeave();
