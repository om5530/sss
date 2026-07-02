import { Component, OnDestroy, afterNextRender, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ProductService } from '../../core/services/product.service';
import { MotionService } from '../../core/services/motion.service';
import { ShopService } from '../../core/services/shop.service';
import { Dietary, Menu as MenuModel, Product } from '../../core/models/product.model';
import { ProductCard } from '../../shared/components/product-card/product-card';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';

interface CategoryBlock {
  category: string;
  products: Product[];
}
interface GroupBlock {
  group: string;
  label: string;
  categories: CategoryBlock[];
}

const GROUP_ORDER: { key: string; label: string }[] = [
  { key: 'bakery', label: 'Bakery' },
  { key: 'savoury', label: 'Savoury & Mains' },
];

@Component({
  selector: 'app-menu',
  imports: [ProductCard, RevealOnScroll],
  templateUrl: './menu.html',
  styleUrl: './menu.scss',
})
export class Menu implements OnDestroy {
  private products = inject(ProductService);
  private motion = inject(MotionService);
  protected shop = inject(ShopService);

  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly search = signal('');
  /** Dietary filter chip — '' means everything. */
  protected readonly dietary = signal<Dietary | ''>('');
  private readonly menu = signal<MenuModel>({});

  protected readonly dietaryChips: { key: Dietary | ''; label: string }[] = [
    { key: '', label: 'Everything' },
    { key: 'veg', label: 'Veg' },
    { key: 'egg', label: 'Contains egg' },
    { key: 'non-veg', label: 'Non-veg' },
  ];

  /** UI-only: category currently highlighted in the sticky rail. */
  protected readonly activeCat = signal('');
  /** UI-only: back-to-top affordance visibility. */
  protected readonly showTop = signal(false);

  /** Flattened, ordered, search + dietary-filtered view model. */
  protected readonly blocks = computed<GroupBlock[]>(() => {
    const menu = this.menu();
    const term = this.search().trim().toLowerCase();
    const dietary = this.dietary();

    return GROUP_ORDER.map(({ key, label }) => {
      const categories = Object.entries(menu[key] ?? {})
        .map(([category, items]) => ({
          category,
          products: items.filter(
            (p) =>
              (!dietary || p.dietary === dietary) &&
              (!term ||
                p.name.toLowerCase().includes(term) ||
                p.description.toLowerCase().includes(term)),
          ),
        }))
        .filter((c) => c.products.length > 0)
        .sort((a, b) => a.category.localeCompare(b.category));
      return { group: key, label, categories };
    }).filter((g) => g.categories.length > 0);
  });

  protected readonly hasResults = computed(() => this.blocks().length > 0);

  /** Flat list of categories for the sticky nav. */
  protected readonly navCategories = computed(() =>
    this.blocks().flatMap((g) => g.categories.map((c) => c.category)),
  );

  /** UI-only: how many dishes survive the current search filter. */
  protected readonly resultCount = computed(() =>
    this.blocks().reduce(
      (total, group) => total + group.categories.reduce((n, c) => n + c.products.length, 0),
      0,
    ),
  );

  private route = inject(ActivatedRoute);
  private scrollScheduled = false;

  constructor() {
    this.shop.load();

    // QR table ordering: /menu?table=12 remembers the table for checkout.
    // A normal menu visit clears it — a QR scanned last week must not force
    // dine-in on someone browsing from home today.
    const table = this.route.snapshot.queryParamMap.get('table');
    if (table) sessionStorage.setItem('sss_table', table.slice(0, 10));
    else sessionStorage.removeItem('sss_table');

    this.products.getMenu().subscribe({
      next: (menu) => {
        this.menu.set(menu);
        this.loading.set(false);
        // Deep-link from the home category cards (e.g. /menu#Brownies).
        const fragment = this.route.snapshot.fragment;
        if (fragment) setTimeout(() => this.scrollTo(fragment), 120);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });

    // Presentation-only: scroll-spy for the rail + back-to-top visibility.
    afterNextRender(() => {
      window.addEventListener('scroll', this.onWindowScroll, { passive: true });
      this.onWindowScroll();
    });
  }

  onSearch(value: string) {
    this.search.set(value);
  }

  scrollTo(category: string) {
    const el = document.getElementById('cat-' + category);
    if (!el) return;
    this.activeCat.set(category);
    // Lenis-aware smooth scroll; offset clears navbar + sticky rail.
    this.motion.scrollTo(el, -140);
  }

  scrollTop() {
    this.motion.scrollTo(document.body, 0);
  }

  /** rAF-throttled scroll handler — cheap even mid-Lenis-glide. */
  private readonly onWindowScroll = () => {
    if (this.scrollScheduled) return;
    this.scrollScheduled = true;
    requestAnimationFrame(() => {
      this.scrollScheduled = false;
      this.showTop.set(window.scrollY > 720);
      let current = '';
      for (const cat of this.navCategories()) {
        const el = document.getElementById('cat-' + cat);
        if (el && el.getBoundingClientRect().top <= 170) current = cat;
      }
      this.activeCat.set(current);
    });
  };

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onWindowScroll);
  }
}
