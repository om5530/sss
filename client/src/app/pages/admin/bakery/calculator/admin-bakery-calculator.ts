import { Component, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
@Component({
  selector: 'app-admin-bakery-calculator',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-bakery-calculator.html',
  styleUrl: './admin-bakery-calculator.scss',
})
export class AdminBakeryCalculator {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private destroy = inject(DestroyRef);
  private request?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;
  recipes = signal<any[]>([]);
  result = signal<any>(null);
  busy = signal(false);
  saving = signal(false);
  error = signal('');
  notice = signal('');
  items: any[] = [{ recipeId: '', quantity: '1', uom: '', options: [] }];
  pricingMode = 'markup';
  percent = '50';
  referenceName = '';
  customerName = '';
  requiredDate = '';
  notes = '';
  constructor() {
    this.destroy.onDestroy(() => {
      this.request?.unsubscribe();
      clearTimeout(this.timer);
    });
  }
  ngOnInit() {
    this.http.get<any>('/api/admin/bakery/recipes').subscribe({
      next: (r) => {
        this.recipes.set(r.recipes);
        this.items[0].recipeId =
          this.route.snapshot.queryParamMap.get('recipeId') || r.recipes[0]?._id || '';
        this.calculate();
      },
      error: (e) => this.error.set(e.error?.message || 'Could not load recipes'),
    });
  }
  recipe(item: any) {
    return this.recipes().find((r) => r._id === item.recipeId);
  }
  change(item: any) {
    item.uom = '';
    item.options = [];
    this.calculate();
  }
  add() {
    this.items.push({
      recipeId: this.recipes()[0]?._id || '',
      quantity: '1',
      uom: '',
      options: [],
    });
    this.calculate();
  }
  remove(i: number) {
    this.items.splice(i, 1);
    this.calculate();
  }
  option(item: any, name: string, on: boolean) {
    item.options = on ? [...item.options, name] : item.options.filter((v: string) => v !== name);
    this.calculate();
  }
  payload() {
    return {
      items: this.items,
      ...(this.pricingMode === 'margin'
        ? { targetMargin: this.percent }
        : { targetMarkup: this.percent }),
    };
  }
  calculate() {
    this.request?.unsubscribe();
    clearTimeout(this.timer);
    this.result.set(null);
    this.error.set('');
    this.busy.set(true);
    this.timer = setTimeout(() => {
      if (this.items.some((i) => !i.recipeId || !(Number(i.quantity) > 0))) {
        this.busy.set(false);
        return;
      }
      this.request = this.http
        .post<any>('/api/admin/bakery/simulate/multi', this.payload())
        .subscribe({
          next: (r) => {
            this.result.set(r.aggregated);
            this.busy.set(false);
          },
          error: (e) => {
            this.error.set(e.error?.message || 'Calculation failed');
            this.busy.set(false);
          },
        });
    }, 250);
  }
  save(type: string) {
    if (this.saving() || this.busy() || !this.result()) return;
    this.saving.set(true);
    this.error.set('');
    this.http
      .post<any>('/api/admin/bakery/costing-sheets', {
        ...this.payload(),
        type,
        referenceName: this.referenceName || 'Kitchen plan',
        customerName: this.customerName,
        requiredDate: this.requiredDate || undefined,
        notes: this.notes,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.notice.set(
            'Saved. Open Production to review the saved sheet or record actual production.',
          );
        },
        error: (e) => {
          this.saving.set(false);
          this.error.set(e.error?.message || 'Could not save');
        },
      });
  }
  print() {
    window.print();
  }
  positive(v: any) {
    return Number(v) > 0;
  }
}
