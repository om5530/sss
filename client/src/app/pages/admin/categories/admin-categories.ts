import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminService, ManagedCategory } from '../../../core/services/admin.service';
import { ConfirmModal } from '../shared/confirm-modal';

@Component({
  selector: 'app-admin-categories', imports: [FormsModule, RouterLink, ConfirmModal],
  templateUrl: './admin-categories.html',
})
export class AdminCategories {
  private admin = inject(AdminService);
  protected categories = signal<ManagedCategory[]>([]);
  protected busy = signal(false);
  protected error = signal('');
  protected editing = signal<string | undefined>(undefined);
  protected deleteTarget = signal<ManagedCategory | null>(null);
  protected name = '';
  protected group: 'bakery' | 'savoury' = 'bakery';
  protected groups = ['bakery', 'savoury'] as const;
  constructor() { this.load(); }
  rows(group: string) { return this.categories().filter((c) => c.group === group); }
  load() {
    this.admin.categories().subscribe({ next: (rows) => this.categories.set(rows), error: () => this.error.set('Could not load categories. Please retry.') });
  }
  edit(category: ManagedCategory) { this.editing.set(category._id); this.name = category.name; this.group = category.group; }
  reset() { this.editing.set(undefined); this.name = ''; }
  save() {
    if (this.busy() || !this.name.trim()) return;
    this.busy.set(true); this.error.set('');
    this.admin.saveCategory({ name: this.name, group: this.group }, this.editing()).subscribe({
      next: (category) => {
        this.categories.update((rows) => {
          const previous = rows.find((row) => row._id === category._id);
          return [...rows.filter((row) => row._id !== category._id), { ...category, count: previous?.count ?? 0 }]
            .sort((a, b) => a.group.localeCompare(b.group) || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
        });
        this.busy.set(false); this.reset();
      },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Could not save category.'); },
    });
  }
  remove() {
    const target = this.deleteTarget();
    if (!target || this.busy()) return;
    this.busy.set(true); this.error.set('');
    this.admin.deleteCategory(target._id).subscribe({
      next: () => {
        this.categories.update((rows) => rows.filter((row) => row._id !== target._id));
        this.busy.set(false); this.deleteTarget.set(null);
      },
      error: (err) => { this.busy.set(false); this.deleteTarget.set(null); this.error.set(err.error?.message || 'Could not delete category.'); },
    });
  }
  move(category: ManagedCategory, direction: number) {
    if (this.busy()) return;
    const rows = this.rows(category.group).filter((c) => !c.archived);
    const index = rows.findIndex((c) => c._id === category._id);
    if (index + direction < 0 || index + direction >= rows.length) return;
    [rows[index], rows[index + direction]] = [rows[index + direction], rows[index]];
    this.busy.set(true); this.error.set('');
    this.admin.reorderCategories(category.group, rows.map((c) => c._id)).subscribe({
      next: () => {
        this.categories.update((all) => [
          ...all.filter((item) => item.group !== category.group || item.archived),
          ...rows.map((item, displayOrder) => ({ ...item, displayOrder })),
        ].sort((a, b) => a.group.localeCompare(b.group) || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)));
        this.busy.set(false);
      },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Could not reorder categories.'); },
    });
  }
}
