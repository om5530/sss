import { Directive, ElementRef, HostListener, OnDestroy, inject } from '@angular/core';

/** Number inputs do not expose selection APIs. Use text only while editing;
 * Angular retains the number accessor and min/max validators from the template. */
@Directive({ selector: 'input[type=number][appQuantityCaret]' })
export class QuantityCaret implements OnDestroy {
  private readonly input = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private frame = 0;
  private firstClick = false;

  @HostListener('focus')
  focus() {
    this.input.type = 'text';
    this.input.inputMode = 'numeric';
    this.firstClick = true;
    this.frame = requestAnimationFrame(() => this.moveToEnd());
  }

  @HostListener('pointerdown')
  pointerDown() {
    if (document.activeElement === this.input) {
      this.firstClick = false;
      cancelAnimationFrame(this.frame);
    }
  }

  @HostListener('click')
  click() {
    if (this.firstClick) {
      this.firstClick = false;
      cancelAnimationFrame(this.frame);
      this.moveToEnd();
    }
  }

  @HostListener('beforeinput', ['$event'])
  beforeInput(event: InputEvent) {
    if (event.isComposing || !event.inputType.startsWith('insert')) return;
    const data = event.data ?? event.dataTransfer?.getData('text/plain');
    if (data != null && !/^\d*$/.test(data)) event.preventDefault();
  }

  @HostListener('paste', ['$event'])
  paste(event: ClipboardEvent) {
    if (!/^\d*$/.test(event.clipboardData?.getData('text/plain') ?? '')) event.preventDefault();
  }

  @HostListener('blur')
  blur() {
    cancelAnimationFrame(this.frame);
    this.firstClick = false;
    this.input.type = 'number';
  }

  private moveToEnd() {
    if (document.activeElement !== this.input || this.input.type !== 'text') return;
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
  }

  ngOnDestroy() { cancelAnimationFrame(this.frame); }
}
