import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { AdminOrder, OrderFilters } from '../../../core/models/admin.model';
import { orderSource } from '../shared/admin-ui';

@Component({
  selector: 'app-admin-orders',
  imports: [RouterLink, FormsModule, DatePipe, DecimalPipe],
  templateUrl: './admin-orders.html',
  styleUrl: './admin-orders.scss',
  styles: `
    .payment-method--upi { background: #eee8fb; color: #61409b; }
    .payment-method--cash { background: #e2f1e7; color: #286442; }
    .order-delete-dialog { margin: auto; max-height: calc(100dvh - 1.5rem); overflow: auto; color: var(--ink); }
    .order-delete-dialog::backdrop { background: rgba(18, 10, 6, 0.55); backdrop-filter: blur(6px); }
  `,
})
export class AdminOrders {
  private admin = inject(AdminService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  protected readonly orders = signal<AdminOrder[]>([]);
  protected readonly total = signal(0);
  protected readonly pages = signal(1);
  protected readonly loading = signal(true);
  protected readonly filtersOpen = signal(false);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly pendingDelete = signal<AdminOrder | null>(null);
  private readonly deleteDialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDialog');

  private readonly eventStorageKey = 'bc_admin_orders_event';
  protected readonly eventNames = signal<string[]>([]);
  // Date and event filters remain shareable through the URL.
  protected eventName = '';
  protected from = '';
  protected to = '';
  protected page = 1;

  protected readonly orderSource = orderSource;

  protected paymentMethodLabel(order: AdminOrder): string {
    switch (order.paymentMethod) {
      case 'cash': return 'Cash';
      case 'upi': return 'UPI';
      case 'card': return 'Card';
      case 'online': return 'Online';
      default: return '—';
    }
  }

  private listRequest?: Subscription;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.listRequest?.unsubscribe();
    });
    const params = this.route.snapshot.queryParamMap;
    try {
      this.eventName = params.get('eventName') ?? localStorage.getItem(this.eventStorageKey) ?? '';
    } catch {
      this.eventName = params.get('eventName') ?? '';
    }
    this.admin.eventOptions().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ events }) => this.eventNames.set(events.map((event) => event.eventName)),
      error: () => this.toast.error('Could not load events. Please reopen Orders to try again.'),
    });
    this.from = params.get('from') ?? '';
    this.to = params.get('to') ?? '';
    this.page = Math.max(1, Number(params.get('page')) || 1);
    this.apply(false);
  }

  protected apply(resetPage = true) {
    if (resetPage) this.page = 1;
    try {
      localStorage.setItem(this.eventStorageKey, this.eventName);
    } catch { /* Keep filtering for this visit when browser storage is unavailable. */ }
    const queryParams: Record<string, string | number | null> = {
      q: null,
      status: null,
      type: null,
      payment: null,
      amount: null,
      source: this.eventName ? 'event' : null,
      eventName: this.eventName || null,
      from: this.from || null,
      to: this.to || null,
      page: this.page > 1 ? this.page : null,
    };
    this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
    this.fetch();
  }

  protected clearFilters() {
    this.eventName = this.from = this.to = '';
    this.apply();
  }

  protected goToPage(page: number) {
    this.page = Math.min(Math.max(1, page), this.pages());
    this.apply(false);
  }

  protected deleteOrder(order: AdminOrder, event: Event) {
    event.stopPropagation();
    event.preventDefault();
    if (this.deletingId()) return;
    this.pendingDelete.set(order);
    this.deleteDialog().nativeElement.showModal();
  }

  protected cancelDelete() {
    if (this.deletingId()) return;
    this.deleteDialog().nativeElement.close();
    this.pendingDelete.set(null);
  }

  protected confirmDelete() {
    const order = this.pendingDelete();
    if (!order || this.deletingId()) return;

    this.deletingId.set(order._id);
    this.admin.deleteOrder(order._id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.cancelDelete();
        this.toast.success(`Order ${order.orderNumber} permanently deleted`);
        this.apply(false);
      },
      error: (err) => {
        this.deletingId.set(null);
        if (err.status > 0 && err.status < 500) {
          this.toast.error(err.error?.message || 'Could not delete the order. Please try again.');
        }
      },
    });
  }

  protected get hasFilters(): boolean {
    return Boolean(this.eventName || this.from || this.to);
  }

  private fetch() {
    this.listRequest?.unsubscribe();
    this.loading.set(true);
    const filters: OrderFilters = {
      source: this.eventName ? 'event' : undefined,
      eventName: this.eventName || undefined,
      from: this.from || undefined,
      to: this.to || undefined,
      page: this.page,
    };
    this.listRequest = this.admin.orders(filters).subscribe({
      next: (res) => {
        this.orders.set(res.orders);
        this.total.set(res.total);
        this.pages.set(res.pages);
        if (this.page > res.pages) {
          this.page = res.pages;
          this.apply(false);
          return;
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
