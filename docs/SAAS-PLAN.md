# SaaS Plan — from "Sweet Savory Savor" to a multi-tenant bakery platform

> **Status: PLAN ONLY.** Nothing here is being built now. This document exists so that when (if) we decide to productize, we start from a researched position instead of a blank page. Market figures below are from a research sweep dated 2026-07 (source years noted inline).

**Working titles:** BakeOS · CrumbLabs · OvenFront · Bakester *(pick later; check trademarks/domains)*

---

## 1. The one-liner

**A zero-commission, WhatsApp-native, UPI-first ordering platform built specifically for Indian bakeries and cafés** — the storefront, order queue, custom-cake pipeline and customer relationship in one flat-fee subscription. What Sweet Savory Savor already runs, offered to every bakery.

## 2. Why this could work (the wedge)

- **Aggregator pain is real and worsening.** Zomato/Swiggy all-in take is **25–35% per order** (2025, commissions + fees + GST); both moved to tiered commissions and paid priority listing in 2025; Zomato raised the consumer platform fee 19% to ₹14.90 in March 2026. On a ₹300 brownie box, the bakery loses ~₹75–105 — lethal at bakery margins.
- **The market is big and fragmented.** India's bakery market: **USD 12–15B in 2025 → ~USD 32B by 2034** (~9% CAGR, IMARC/EMR 2025). Cafés & bars: USD 18.8B (2025), and **76% of outlets are independents** — exactly the long tail a self-serve SaaS targets.
- **WhatsApp + UPI are the tailwinds.** F&B brands report **20–30% higher repeat orders** via WhatsApp reorder flows (2025); UPI has **0% MDR by mandate** (reaffirmed 2025) plus a 0.15% government incentive on small-merchant transactions ≤₹2,000. High-repeat, low-AOV bakery purchases are the perfect shape for messaging + UPI.
- **We already have the product.** The SSS codebase is a working v1: storefront, cart/checkout (cash + Razorpay), coupons, stock, reviews, custom-cake briefs, admin console, notifications, PWA, tests. Competitors would need to build what we can generalize.

## 3. Who it's for

| Segment | Notes |
|---|---|
| **Independent bakeries & patisseries** (primary) | 1–3 outlets, heavy custom-cake business, Instagram-led discovery, currently WhatsApp-DM chaos |
| Home bakers (secondary) | Huge in India; need the custom-cake pipeline + payments more than a full storefront; a cheaper tier |
| Cafés / cloud dessert brands (adjacent) | Same stack works; QR dine-in matters more here |

## 4. Competitive landscape (2025–26 research)

| Player | What | Real pricing | Their gap we exploit |
|---|---|---|---|
| **Zomato/Swiggy** | Aggregators | 25–35% all-in take (2025) | The wedge itself: no data ownership, ad treadmill. We don't beat them at discovery — we convert their *repeat* customers into direct ones |
| **DotPe** | QR dine-in + storefronts + POS | ~₹1–1.5/order, commission-like (2025); opaque | Generalist; zero bakery workflows; per-order fees scale badly; support complaints (2025) |
| **UrbanPiper Meraki** | White-label ordering for chains | Quote-only; last public ₹4,500–9,000/mo (2022) | Built for chains; single-outlet bakeries an afterthought; heavy onboarding |
| **Petpooja** | POS + paid add-ons | ~₹10k/yr POS + ₹5–15k setup; real all-in ₹18–30k/yr with add-ons (2025) | POS-first, storefront-last; dated consumer UX; add-on stacking |
| **Thrive** | Direct ordering + loyalty | 3%/order + subscription (2023–25) | Take-rate model; growth stalled post-2023; generic restaurant focus |
| **Shopify India / Dukaan** | Horizontal storefronts | Shopify realistic all-in ₹3–5k/mo (2026); Dukaan ₹4–30k/yr (2025) | Not food-native: no slots, lead times, dine-in, KOTs, FSSAI display |
| **uEngage Edge** | Direct ordering, 0% commission | ₹7,500–10,000 plans, ~2% gateway (2026) | Closest analogue — but no bakery specialization |
| **ONDC seller apps** | Open-network listing | Free–5% commission (2025) | Network demand fell 35% after subsidies were cut (Oct 2024→Apr 2025); treat as optional upside, not core |
| **Wati / Interakt** | WhatsApp commerce tools | ₹1.2k–6k/mo + Meta fees (2025–26) | A feature for us, not a product: bundling WhatsApp ordering deletes a ₹1,200–2,500/mo line item for the bakery |
| **Rapido Ownly** | 0%-commission delivery app (Bengaluru, Mar 2026) | 0% commission, ₹30 consumer delivery fee | Validates zero-commission mainstreaming — means we must differentiate on **ownership + bakery workflows**, not "0%" alone |

**Positioning sentence:** *"Everything a bakery needs to sell directly — custom cakes, pre-orders, WhatsApp and UPI included — for a flat fee. No commissions. Your customers, your data, your brand."*

## 5. Differentiation (what nobody in that table has)

1. **The custom-cake pipeline** — brief → photo reference → quote → advance payment → production queue → pickup slot. This is 30–60% of a bakery's revenue and *no competitor models it*.
2. **Bake-day operations** — daily stock counts with auto sold-out, prep sheets from pre-orders, kg/half-kg/eggless variants, lead-time rules per product.
3. **WhatsApp-native lifecycle** — order confirmations, "cake is ready" pings, reorder links in chat; bundled instead of a separate Wati subscription.
4. **Honest economics** — flat fee, 0% take, UPI passed through at its true 0% cost ("UPI at 0%, cards ~2% at cost" is a credible, checkable claim per 2025–26 gateway pricing).
5. **A genuinely beautiful storefront** — the SSS design quality is visibly above DotPe/Petpooja bolt-on stores; for Instagram-first bakeries, that's the demo that sells.

## 6. Product tiers (hypothesis to test, anchored to benchmarks)

Market anchors: small-bakery "normal software spend" ≈ ₹800–1,000/mo; Wati+Petpooja-addon stacks ≈ ₹2,500–4,500/mo combined; uEngage ₹7.5–10k plans; setup fees trending to ₹0.

| | **Home Baker** ₹499/mo | **Bakery** ₹1,499/mo | **Bakery Pro** ₹2,999/mo |
|---|---|---|---|
| Storefront + menu + PWA | link-in-bio page | full site, own subdomain | + custom domain |
| Custom-cake pipeline | ✅ | ✅ | ✅ |
| Payments (BYO Razorpay) | UPI only | UPI + cards | + advance-payment rules |
| Orders/month included | 100 | 1,000 | unlimited |
| WhatsApp notifications | — | ✅ | + broadcasts/campaigns |
| Coupons, stock, reviews | basic | ✅ | + loyalty, gift cards |
| QR dine-in, multi-staff roles | — | — | ✅ |
| Outlets | 1 | 1 | up to 3 (+₹999/extra) |

₹0 setup, self-serve onboarding, monthly billing (annual = 2 months free). **Unit economics sketch:** infra cost per tenant at this scale is single-digit ₹/mo (shared Mongo/Vercel/Cloudinary) + WhatsApp conversation fees (~₹0.13–0.16/utility message, 2025–26, metered into plan limits); gross margin >85%. 100 paying bakeries ≈ ₹1.5–3L MRR.

## 7. Architecture plan (how the current codebase becomes multi-tenant)

### Tenancy model
- **Single Mongo cluster, shared collections, `tenantId` on every document** (products, orders, coupons, reviews, cake requests, users, payments, audit). A Mongoose plugin injects `tenantId` into every query/write — one enforcement point, testable. DB-per-tenant is operationally wrong at this price point.
- **Compound indexes** led by `tenantId` (e.g. `{tenantId, slug}` unique on products; `{tenantId, code}` on coupons).
- **Customer identity is per-tenant** (a phone number at Bakery A is a different account than at Bakery B) — matches how buyers think and avoids cross-tenant data questions.

### Tenant resolution & domains
- `Host` header → tenant lookup (cached): `harshita.bakeos.in` (wildcard subdomain) and custom domains via the host platform's domain API. Vercel supports both; wildcard needs the domain on Vercel DNS.
- Storefront becomes **config-driven theming**: the SSS design is Theme #1. Tenant config = logo, palette (CSS variables already drive the design), hero images, copy blocks, hours, fees, feature flags. Later: a second, simpler theme.

### Payments
- **Phase 1: BYO keys** — each bakery pastes its own Razorpay keys (exactly today's model). Zero payment-compliance burden on us.
- **Phase 2: Razorpay Route / Partner** — we onboard merchants under our partner account, enabling instant activation and an optional take-rate revenue line. Only after PMF.

### Platform layer (net-new build)
- **Tenant onboarding wizard**: shop name → logo/colors → menu import (CSV; later photo-of-menu → AI extraction) → payment keys → subdomain live. Target: **first order within 24h of signup**.
- **Super-admin console**: tenant list, plan/limits enforcement, usage metrics, impersonation for support, kill switch.
- **Billing**: Razorpay Subscriptions for the SaaS fee itself; plan-limit middleware (orders/month) with soft warnings before hard caps.

### Engineering prerequisites (mostly already on IDEAS.md)
- **Redis (Upstash) for rate limits, caches, queues** — the current in-memory stores are per-lambda; multi-tenant makes this mandatory, not optional.
- **CI + Sentry + E2E tests** — before any second tenant.
- **Tenant-isolation test suite** — the single most important test file in the product: prove tenant A can never read/write tenant B, for every route.
- Notifications: per-tenant sender identities (Resend domains / WhatsApp numbers); Cloudinary folders per tenant.

### Migration path (phases, rough effort)
| Phase | What | Effort |
|---|---|---|
| **P0 — Themeable single-tenant** | Extract all SSS branding/copy/fees into a config object; second deployment = second bakery by config. Validates demand with ~zero architecture risk. | ~1–2 weeks |
| **P1 — Multi-tenant core** | `tenantId` plugin + indexes + host resolution + isolation tests; migrate SSS as tenant #1 | ~3–4 weeks |
| **P2 — Self-serve** | Onboarding wizard, billing, plan limits, super-admin | ~3–4 weeks |
| **P3 — Moat features** | WhatsApp-native ordering, menu AI import, theme #2, loyalty | ongoing |

*(P0 is also the "agency mode" fallback — see §10.)*

## 8. Compliance (India-specific, from 2025 research)

- **FSSAI**: stay a **software provider** (each bakery sells under its own FSSAI license) — far lighter than marketplace obligations. Build in: FSSAI number display on storefront/receipts + license-expiry reminders. (July 2025 e-commerce norms tightened hygiene/transparency; penalties to ₹10L.)
- **DPDP Act**: Rules notified Nov 2025, full compliance by **May 2027**, no small-business exemption for core duties. Build consent notices, data-deletion workflows, and a 72-hour breach-notification playbook *into the platform* — then sell it as a trust feature ("your customer data, DPDP-ready").

## 9. Go-to-market

1. **Design partner: Harshita** (live now). Instrument everything; her usage is the case study — "X% of orders moved off aggregators, ₹Y saved per month."
2. **Pilot: 10 Mumbai bakeries** — hand-onboarded (P0 config mode), free 3 months → ₹999/mo. Source from bakery Instagram + wholesale-supplier networks + home-baker WhatsApp groups.
3. **Channels at scale**: Instagram content (before/after storefront glow-ups), referral from bakery to bakery (they all know each other), bakery-supplies distributors as resellers (Petpooja's reseller model works — copy it), SEO ("zero commission bakery website").
4. **The demo IS the pitch**: sss-omega-ashy.vercel.app opened on a phone next to their DotPe store.

## 10. Metrics, risks, and kill criteria

**North-star:** GMV flowing through tenant storefronts. **Supporting:** MRR, activation (first real order ≤7 days from signup), 90-day logo retention, orders/tenant/week, % tenants using cake pipeline (differentiation validator).

| Risk | Honest read | Mitigation |
|---|---|---|
| "Zero commission" commoditizing (Rapido Ownly, Mar 2026) | Real — 0% alone won't sell by 2027 | Differentiate on cake pipeline + ownership + WhatsApp; 0% is table stakes |
| Bakeries won't leave Zomato demand | True — they shouldn't | Position as the *repeat-customer* channel next to aggregators, never a replacement |
| Support burden of non-technical merchants | The actual cost center of this business | Self-serve UX, WhatsApp support, reseller network absorbs hand-holding |
| Churn after festival seasons | F&B SaaS reality | Annual plans discounted; loyalty/CRM features create data gravity |
| Two-founder-attention problem | This is a company, not a feature | Don't start until SSS itself is stable + generating reference revenue |

**Go signals** (any two → start P0): Harshita runs 3+ months with real order volume and a savings story; 5+ bakeries ask "can I get this?"; a pilot bakery pre-pays.
**No-go signals**: SSS needs constant firefighting; pilot bakeries stop using it after week 2; nobody accepts ₹999/mo after a free trial.
**Fallback that still wins:** even if SaaS never happens, P0 (config-driven theming) turns this codebase into an **agency asset** — sell bespoke bakery sites at ₹30–60k setup + ₹1,500/mo maintenance, one deployment each. Lower ceiling, immediate revenue, zero platform risk.

---

*Companion docs: `IDEAS.md` (single-bakery feature backlog), `PRE-LAUNCH-CHECKLIST.md` (current launch state).*
