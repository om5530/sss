# Sweet Savory Savor — "Midnight Patisserie" Design System

The reference implementation lives in `client/src/styles.scss` (tokens + primitives) and the
**exemplar pages**: `pages/home/*`, `shared/components/navbar/*`, `shared/components/footer/*`,
`shared/components/product-card/*`. Read those before styling anything — every page must look
like the same designer built it on the same day.

## 1. Concept

Cinematic dark-espresso ("midnight") acts frame warm cream editorial acts. Real photography is
the hero — never emoji, never clipart, never procedural art. Gold is the luxury accent, raspberry
(berry) is the appetite/CTA accent. Motion is buttery and restrained: things rise, settle and
glow — nothing bounces or spins.

- **Dark surfaces** (`--night`, `--night-2`, `--night-3`): heroes, page headers, CTA bands, footer.
- **Light surfaces** (`--cream`, `--cream-2`, `--white`): content, forms, cards, reading.
- Most inner pages = a compact dark page-header band + cream content below. Commerce/status pages
  (cart, checkout, orders) may stay fully light with dark accents — keep forms on light surfaces.

## 2. Tokens (use these, never hard-code)

Palette: `--night --night-2 --night-3 --espresso` · `--cream --cream-2 --sand --white` ·
`--caramel --caramel-dark --cocoa --choco` · `--berry --berry-deep` · `--gold --gold-bright` ·
`--pistachio` · ink: `--ink --muted --line` · dark ink: `--d-text --d-muted --d-faint --d-line` ·
states: `--danger --success`.

Effects: `--radius-sm --radius --radius-lg`, `--shadow-sm --shadow --shadow-lg`,
`--glow-gold --glow-berry`. Motion: `--ease-out --ease-luxe --dur`. Fonts: `--font-display`
(Fraunces) for headings/prices/big numbers, `--font-body` (Manrope) for everything else.

## 3. Ready-made primitives (in styles.scss — reuse, don't reinvent)

- Buttons: `.btn` + `--primary --accent --gold --ghost --ghost-dark --lg --sm --block`
  (all have a hover sheen sweep built in). Gold = hero CTA on dark; accent (berry) = commerce
  CTA (add/pay/place order); primary = neutral dark; ghost per surface.
- Surfaces: `.card`, `.glass`, `.glass-dark`, `.pill`, `.grain` (film grain overlay for dark bands).
- Forms: `.field .label .input .select .textarea .error-text` (gold focus ring built in).
- Type: `.eyebrow` (+ `--bare`), `.display`, `.serif-italic`, `.muted`, `.section__head`
  (+ `--row --center`), `.on-dark` wrapper fixes heading/eyebrow colors on dark surfaces.
- Reveal: `appReveal` directive — `appReveal` (fade-up), `appReveal="left|right|zoom|blur"`,
  `appReveal="group"` (staggers direct children), `[revealDelay]="120"`.
- Other directives (import from `shared/directives/`): `[appParallax]="0.2"` scroll drift,
  `[appTilt]="5"` pointer tilt (cards), `[appCounter]="42" [counterDecimals]="1"` count-up,
  `appMagnetic` magnetic hover (big CTAs only).
- `.marquee > .marquee__track` + `--marquee-speed` for drifting strips; `.skeleton` shimmer;
  `.line-mask > .line-inner` for GSAP masked headlines (home only, don't copy without GSAP).
- `MotionService` (`core/services/motion.service.ts`): `scrollTo(el, offset)` for smooth
  anchor scrolling that cooperates with Lenis; `lock()` while modals/drawers are open.

## 4. Page-header pattern (for inner pages)

```html
<header class="page-hero grain">           <!-- position:relative; dark -->
  <div class="container">
    <span class="eyebrow">Small label</span>
    <h1>Big Fraunces title</h1>
    <p>One quiet supporting line.</p>
  </div>
</header>
```
SCSS recipe: `background: radial-gradient(80% 100% at 85% 0%, rgba(223,167,87,.12), transparent 55%), linear-gradient(180deg, var(--night-2), var(--night));`
padding `clamp(56px, 9vw, 110px) 0 clamp(40px, 6vw, 72px)`; `h1` color `var(--d-text)`,
size `clamp(2.2rem, 5vw, 3.6rem)`; lead `var(--d-muted)`. Eyebrow gold. Keep it compact —
inner pages are tools, not billboards.

## 5. Rules

1. **Real photography only** (existing Pexels/Unsplash pipeline, `foodImage()` /
   `categoryImage()` helpers). No emoji as UI, no icon fonts — inline stroke SVGs
   (`stroke-width` 1.6–1.8, `round` caps) like navbar/home.
2. Headings/prices/big numbers: Fraunces. Body/UI: Manrope. Prices may use
   `font-variant-numeric: tabular-nums`.
3. Radii: cards `--radius-lg`, inputs/small `--radius-sm`, media `--radius`. Pills fully round.
4. Hovers: lift `translateY(-4px..-8px)` + shadow + border warm-up, `0.4–0.6s var(--ease-out)`.
   Focus states must stay visible (global `:focus-visible` is gold — don't suppress it).
5. Reveal choreography on every page: section heads `appReveal`, grids `appReveal="group"`.
   Don't animate form fields' layout; keep checkout/cart interactions instant.
6. `prefers-reduced-motion` must leave every page fully readable (the directives already
   handle themselves; don't add raw CSS animations without a reduce guard).
7. Responsive: verify 1200 / 1020 / 900 / 760 / 560 / 380 px. Mobile = single column, generous
   tap targets (min 44px), horizontal scroll only as deliberate snap carousels.
8. Empty states: warm illustration-free copy + one clear CTA (see home's `.empty`).
   Loading: `.skeleton` blocks matching final layout.
9. Never modify: `styles.scss`, `index.html`, `angular.json`, shared components/directives/
   services/models, other pages. Your page's `.ts` may only change presentation concerns
   (imports of directives, small UI signals) — never business logic, API calls, or routing.
10. Keep every existing binding, handler, guard and test-relevant behavior working.
