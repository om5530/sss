import { Directive, input } from '@angular/core';

/** Adds an accessible spinner without replacing a button's label or validation. */
@Directive({
  selector: 'button[appBusy]',
  host: {
    '[class.adm-button-busy]': 'appBusy()',
    '[attr.aria-busy]': 'appBusy() ? "true" : null',
  },
})
export class BusyButton {
  readonly appBusy = input(false);
}
