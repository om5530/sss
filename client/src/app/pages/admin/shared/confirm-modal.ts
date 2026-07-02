import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * Confirmation dialog for destructive / money-moving admin actions (AS-10.2).
 * The parent controls visibility with @if; `confirmed` emits the reason text
 * (empty string when no reason is required).
 */
@Component({
  selector: 'adm-confirm-modal',
  imports: [FormsModule],
  template: `
    <div class="adm-modal-backdrop" (click)="cancelled.emit()">
      <div class="adm-modal" role="dialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()">
        <h3>{{ title() }}</h3>
        <p>{{ message() }}</p>

        @if (requireReason()) {
          <div class="field">
            <label class="label" for="adm-confirm-reason">{{ reasonLabel() }}</label>
            <textarea
              id="adm-confirm-reason"
              class="textarea"
              rows="2"
              [(ngModel)]="reasonValue"
              [placeholder]="reasonPlaceholder()"
            ></textarea>
          </div>
        }

        <div class="adm-modal__actions">
          <button type="button" class="btn btn--ghost btn--sm" (click)="cancelled.emit()">Keep as is</button>
          <button
            type="button"
            class="btn btn--sm"
            [class.btn--accent]="tone() === 'danger'"
            [class.btn--primary]="tone() !== 'danger'"
            [disabled]="busy() || (requireReason() && !reasonValue.trim())"
            (click)="confirmed.emit(reasonValue.trim())"
          >
            {{ busy() ? 'Working…' : confirmLabel() }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ConfirmModal {
  readonly title = input('Are you sure?');
  readonly message = input('');
  readonly confirmLabel = input('Confirm');
  readonly tone = input<'primary' | 'danger'>('primary');
  readonly requireReason = input(false);
  readonly reasonLabel = input('Reason');
  readonly reasonPlaceholder = input('e.g. item out of stock');
  readonly busy = input(false);

  readonly confirmed = output<string>();
  readonly cancelled = output<void>();

  protected reasonValue = '';
}
