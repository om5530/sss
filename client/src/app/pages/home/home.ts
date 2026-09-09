import { Component, ElementRef, OnDestroy, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProductService } from '../../core/services/product.service';
import { Product } from '../../core/models/product.model';
import { ProductCard } from '../../shared/components/product-card/product-card';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';
import { Parallax } from '../../shared/directives/parallax.directive';
import { Tilt } from '../../shared/directives/tilt.directive';
import { Counter } from '../../shared/directives/counter.directive';
import { Magnetic } from '../../shared/directives/magnetic.directive';
import { categoryImage } from '../../core/utils/food-image';
import { loadGsap, prefersReducedMotion } from '../../shared/motion/gsap';
import type { HeroScene } from '../../shared/motion/hero-scene';

interface ShowcaseCategory {
  name: string;
  note: string;
  image: string;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink, ProductCard, RevealOnScroll, Parallax, Tilt, Counter, Magnetic],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnDestroy {
  private products = inject(ProductService);
  private host = inject(ElementRef<HTMLElement>);

  private heroVideo = viewChild<ElementRef<HTMLVideoElement>>('heroVideo');
  private heroCanvas = viewChild<ElementRef<HTMLElement>>('heroCanvas');

  protected readonly featured = signal<Product[]>([]);
  protected readonly loading = signal(true);
  /** Index of the category whose photo fills the showcase panel. */
  protected readonly activeCat = signal(0);
  /** Which FAQ is expanded (-1 ⇒ none). */
  protected readonly openFaq = signal(0);

  private scene?: HeroScene;
  private gsapCtx?: { revert: () => void };

  /* ---------------- Content ---------------- */

  protected readonly showcase: ShowcaseCategory[] = [
    { name: 'Brownies', note: 'Gooey-centred, crackle-topped', image: categoryImage('Brownies') },
    { name: 'Cookies', note: 'Bent, chewy, still warm', image: categoryImage('Cookies') },
    { name: 'Cakes', note: 'Layered slow, iced by hand', image: categoryImage('Cakes') },
    { name: 'Tiramisu', note: 'Espresso-soaked, cloud-light', image: categoryImage('Tiramisu') },
    { name: 'Cupcakes', note: 'Small bakes, big buttercream', image: categoryImage('Cupcakes') },
    { name: 'Pastries', note: 'Laminated at dawn, 27 layers', image: categoryImage('Pastries') },
    { name: 'Pizza', note: 'Wood-fired, blistered edges', image: categoryImage('Pizza') },
    { name: 'Burgers', note: 'Brioche buns baked in-house', image: categoryImage('Burgers') },
    { name: 'Sandwiches', note: 'On today’s sourdough', image: categoryImage('Sandwiches') },
    { name: 'Snacks', note: 'Golden, crisp, shareable', image: categoryImage('Snacks') },
  ];

  protected readonly heroCards = [
    { label: 'Butter Croissant', tag: 'Laminated · 27 layers', image: categoryImage('Pastries') },
    { label: 'Fudge Brownie', tag: 'Gooey centre · 72% cocoa', image: categoryImage('Brownies') },
    { label: 'Classic Tiramisu', tag: 'Espresso-soaked', image: categoryImage('Tiramisu') },
  ];

  protected readonly inlineWords = [
    { word: 'warm', image: categoryImage('Pastries') },
    { word: 'gooey', image: categoryImage('Brownies') },
    { word: 'wood-fired', image: categoryImage('Pizza') },
  ];

  protected readonly steps = [
    { n: '01', title: 'Browse & crave', copy: 'A kiosk-style menu with live search, honest photos and veg / egg / non-veg tags on every item.' },
    { n: '02', title: 'Order in a tap', copy: 'Dine-in, takeaway or delivery — sign in with just your phone, pay securely online or at the counter.' },
    { n: '03', title: 'Baked & packed', copy: 'Your order goes straight to the ovens. Small batches, packed warm with care — never sitting under a heat lamp.' },
    { n: '04', title: 'Track to your door', copy: 'Follow every step live — placed, confirmed, preparing, ready — until it’s in your hands.' },
  ];

  protected readonly benefits = [
    { icon: 'oven', title: 'Baked fresh at dawn', copy: 'Ovens light at 5 a.m. Every brownie, loaf and croissant is baked the day you eat it — never frozen.' },
    { icon: 'leaf', title: 'Honest ingredients', copy: 'Real butter, Belgian couverture, stone-milled flour. No premixes, no shortcuts, nothing artificial.' },
    { icon: 'veg', title: 'Every diet welcome', copy: 'Clear veg, eggless and non-veg tags on every single item, so ordering for the whole family is easy.' },
    { icon: 'radar', title: 'Live order tracking', copy: 'Watch your order move from oven to doorstep in real time — no guessing, no cold surprises.' },
    { icon: 'shield', title: 'Payments, secured', copy: 'Cards and UPI handled by Stripe-grade encryption. Your card details never touch our servers.' },
    { icon: 'clock', title: '25-minute average', copy: 'From tap to table in about 25 minutes across our delivery zone — warm is a promise, not a hope.' },
  ];

  protected readonly testimonials = [
    { name: 'Omkar Baacha', initials: 'OB', quote: 'The classic fudge brownie is my pick — rich chocolate, a soft centre and just the right amount of sweetness.' },
    { name: 'Aarchita Menghani', initials: 'AM', quote: 'Loved the salted caramel brownie. That little salty finish makes it such a lovely treat with coffee.' },
    { name: 'Uday Mukherjee', initials: 'UM', quote: 'The chocolate chip cookies have those crisp edges and a soft middle I always look for. Perfect for a tea break.' },
    { name: 'Praveen Rathod', initials: 'PR', quote: 'The walnut brownie is a great choice if you like a little crunch with your chocolate. A simple treat done well.' },
    { name: 'Ebrahim Tohfafarosh', initials: 'ET', quote: 'The double chocolate cookies are a treat for a chocolate lover. I would happily add a box to my next order.' },
  ];

  protected readonly faqs = [
    { q: 'Where do you deliver, and how fast?', a: 'We deliver across the neighbourhood in roughly 25 minutes on average. A flat delivery fee applies at checkout; dine-in and takeaway are always free.' },
    { q: 'Can I order for dine-in or takeaway?', a: 'Yes — pick dine-in, takeaway or delivery at checkout. Dine-in orders are brought to your table; takeaway is packed and waiting at the counter.' },
    { q: 'Do you have eggless and vegetarian options?', a: 'Plenty. Every item carries a clear veg, eggless or non-veg tag, and most of our signature bakes come in an eggless version.' },
    { q: 'How do online payments work?', a: 'Cards and UPI are processed securely — your card details never touch our servers. You can also pay at the counter for dine-in and takeaway.' },
    { q: 'Can I track my order live?', a: 'Every order gets a live status timeline — placed, confirmed, preparing, ready, completed — on your orders page, updated in real time.' },
    { q: 'Do you take custom orders?', a: 'Yes — brownies, cakes, hampers, snacks and more. Send a request through Custom Orders at least a day ahead, and we’ll discuss availability and a quote.' },
  ];

  protected readonly galleryTop: string[];
  protected readonly galleryBottom: string[];

  constructor() {
    const images = this.showcase.map((c) => c.image);
    this.galleryTop = images.slice(0, 5);
    this.galleryBottom = images.slice(5);

    this.products.list({ featured: true }).subscribe({
      next: (products) => {
        this.featured.set(products.slice(0, 6));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    afterNextRender(() => {
      void this.initHero();
      void this.initScene();
    });
  }

  protected setActiveCat(i: number): void {
    this.activeCat.set(i);
  }

  protected toggleFaq(i: number): void {
    this.openFaq.update((open) => (open === i ? -1 : i));
  }

  /* ---------------- Motion ---------------- */

  /**
   * Hero entrance + scroll choreography. Reduced-motion users get the static
   * hero (CSS forces every animated element visible); if GSAP fails to load
   * the `.no-anim` class does the same.
   */
  private async initHero(): Promise<void> {
    const reduceMotion = prefersReducedMotion();
    const root = this.host.nativeElement;

    const video = this.heroVideo()?.nativeElement;
    if (video && !reduceMotion) {
      video.muted = true;
      video.play().catch(() => { /* autoplay blocked — poster stays */ });
    }

    if (reduceMotion) return;

    try {
      const { gsap } = await loadGsap();

      this.gsapCtx = gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.to('.hero .line-inner', { y: 0, duration: 1.15, stagger: 0.14, ease: 'power4.out' }, 0.15)
          .to('[data-hero-fade]', { y: 0, opacity: 1, duration: 0.9, stagger: 0.1 }, 0.55)
          .to('.hero__card', {
            y: 0,
            opacity: 1,
            rotation: (i: number) => [-5, 4, -2][i] ?? 0,
            duration: 1.2,
            stagger: 0.15,
            ease: 'power4.out',
          }, 0.65);

        // Depth on scroll: copy drifts up and fades, video slowly pushes in.
        gsap.to('.hero__inner', {
          yPercent: -14,
          opacity: 0.15,
          ease: 'none',
          scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
        });
        gsap.to('.hero__video', {
          scale: 1.14,
          ease: 'none',
          scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
        });

        // Floating cards follow the pointer at different depths.
        const cards = gsap.utils.toArray<HTMLElement>('.hero__card');
        if (cards.length && window.matchMedia('(pointer: fine)').matches) {
          const movers = cards.map((card, i) => ({
            x: gsap.quickTo(card, 'x', { duration: 0.9, ease: 'power3.out' }),
            y: gsap.quickTo(card, 'y', { duration: 0.9, ease: 'power3.out' }),
            depth: [22, 34, 14][i] ?? 20,
          }));
          root.querySelector('.hero')?.addEventListener('pointermove', ((e: PointerEvent) => {
            const nx = e.clientX / window.innerWidth - 0.5;
            const ny = e.clientY / window.innerHeight - 0.5;
            for (const m of movers) { m.x(nx * m.depth); m.y(ny * m.depth); }
          }) as EventListener, { passive: true });
        }
      }, root);
    } catch {
      root.querySelector('.hero')?.classList.add('no-anim');
    }
  }

  /** Ambient WebGL motes — desktop, motion-friendly, data-friendly only. */
  private async initScene(): Promise<void> {
    const hostEl = this.heroCanvas()?.nativeElement;
    if (!hostEl) return;

    const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData ?? false;
    if (prefersReducedMotion() || saveData || window.innerWidth < 768) return;

    try {
      const { createHeroScene } = await import('../../shared/motion/hero-scene');
      this.scene = createHeroScene(hostEl);
    } catch {
      /* WebGL unavailable — the hero is complete without it. */
    }
  }

  ngOnDestroy(): void {
    this.scene?.dispose();
    this.gsapCtx?.revert();
  }
}
