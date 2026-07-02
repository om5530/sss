# User Stories — Bakery & Café Online Ordering Platform

**Project:** Bakery & Café Online Ordering Platform
**Stack:** MEAN (MongoDB · Express · Angular · Node.js)
**Document version:** 1.0
**Last updated:** 2026-06-24
**Status:** Draft for backlog refinement

---

## 1. Purpose

This document defines the product backlog as a set of **epics** and **user stories** with testable acceptance criteria. It is written in a format suitable for direct import into Jira / Azure Boards and is the single source of truth for what the MVP must deliver.

Each story follows the standard agile template:

> **As a** \<role\>, **I want** \<capability\>, **so that** \<benefit\>.

Acceptance criteria use the **Given / When / Then** (Gherkin) style wherever behaviour is testable, and checklists for static requirements.

---

## 2. Conventions & Legend

| Field | Meaning |
|-------|---------|
| **ID** | Stable identifier, e.g. `US-2.1`. Never reused. |
| **Priority** | MoSCoW — **M**ust / **S**hould / **C**ould / **W**on't (this release) |
| **Points** | Relative estimate (Fibonacci: 1, 2, 3, 5, 8, 13) |
| **Release** | `MVP` (v1.0) or `Future` (post-launch) |

### Personas / Roles

| Role | Description |
|------|-------------|
| **Visitor** | Unauthenticated user browsing the site. |
| **Customer** | Authenticated user who can order, pay and track orders. |
| **Admin** | Staff member managing catalogue, orders and reports. *(Future scope)* |
| **System** | Automated/background behaviour (payments, notifications, status). |

---

## 3. Definition of Ready (DoR)

A story may enter a sprint only when it:

- [ ] Has a clear role, capability and benefit.
- [ ] Has acceptance criteria that are independently testable.
- [ ] Has no unresolved external dependency blocking it.
- [ ] Is estimated by the team.
- [ ] Has UI/UX reference (wireframe or design) where it touches the interface.

## 4. Definition of Done (DoD)

A story is *done* when:

- [ ] Code is implemented, peer-reviewed and merged.
- [ ] Unit/integration tests written and passing; coverage not reduced.
- [ ] Acceptance criteria verified by QA.
- [ ] Responsive on mobile, tablet and desktop.
- [ ] Meets WCAG 2.1 AA for keyboard and contrast where applicable.
- [ ] No new console/server errors; key actions logged.
- [ ] Documentation/API contract updated.

---

## 5. Epics Overview

| Epic | Title | Release |
|------|-------|---------|
| **E1** | Landing Page & Brand Experience | MVP |
| **E2** | Product Catalogue & Browsing | MVP |
| **E3** | Cart & Ordering | MVP |
| **E4** | Authentication & Account | MVP |
| **E5** | Checkout & Order Type | MVP |
| **E6** | Payments | MVP |
| **E7** | Order Management & Tracking | MVP |
| **E8** | Admin Console | Future |
| **E9** | Platform, Non-Functional & Cross-Cutting | MVP |

---

## Epic E1 — Landing Page & Brand Experience

> **Goal:** Give first-time visitors an immersive, premium impression of the brand that converts curiosity into an order.

---

### US-1.1 — Hero landing section
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** visitor, **I want** to see an attractive hero section when I open the website, **so that** I immediately understand the brand and feel invited to order.

**Acceptance Criteria**
- **Given** I navigate to the home page, **then** I see a hero banner containing the bakery brand name, a tagline, a high-quality bakery visual and a primary **"Order Now"** call-to-action.
- **When** I click **"Order Now"**, **then** I am taken to the Menu page.
- **Given** the page loads, **then** the hero is fully visible (above the fold) without scrolling on desktop and mobile.
- The hero image is optimised (lazy/responsive sizes) and has descriptive `alt` text.
- Content (brand name, tagline, CTA label, image) is configurable, not hard-coded in markup.

---

### US-1.2 — Interactive 3D & scroll experience
**Priority:** Should · **Points:** 8 · **Release:** MVP

> **As a** visitor, **I want** an interactive, animated browsing experience, **so that** the website feels premium and engaging.

**Acceptance Criteria**
- **Given** I scroll the landing page, **then** 3D bakery objects (e.g. floating cupcake, rotating cake) animate in response to scroll position using Three.js + GSAP/ScrollTrigger.
- Ambient effects (e.g. falling chocolate particles, coffee steam, pizza-ingredient motion) play without blocking interaction.
- **Given** a low-power device or `prefers-reduced-motion` is set, **then** heavy animations degrade gracefully to static visuals.
- Animations maintain a usable frame rate (target ≥ 30 fps on mid-range mobile) and do not block the main thread for input.
- 3D assets are lazy-loaded so they never delay first contentful paint of the hero.

**Notes:** This is a polish story; it must not gate ordering. Track performance budget in US-9.4.

---

### US-1.3 — Category showcase on landing page
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** visitor, **I want** to preview the product categories from the landing page, **so that** I know what is on offer before entering the menu.

**Acceptance Criteria**
- **Given** I am on the home page, **then** I see featured categories grouped under **Bakery** (Brownies, Cookies, Cakes, Tiramisu, Cupcakes, Pastries) and **Savoury** (Pizza, Burgers, Sandwiches, Snacks).
- Each featured product card shows image, name, short description and price.
- **When** I click a category or product, **then** I am taken to the corresponding section of the Menu page.
- Categories and featured items are sourced from the catalogue API, not static markup.

---

### US-1.4 — Static informational pages (About / Contact)
**Priority:** Should · **Points:** 2 · **Release:** MVP

> **As a** visitor, **I want** to read About Us and Contact information, **so that** I can learn about and reach the bakery.

**Acceptance Criteria**
- About Us page displays the brand story, imagery and location(s).
- Contact page shows address, phone, email, opening hours and an embedded map.
- A contact form (name, email, message) submits successfully and confirms receipt to the user.
- Form input is validated and protected against spam (e.g. honeypot/rate limit).

---

## Epic E2 — Product Catalogue & Browsing

> **Goal:** Let customers find items quickly via a kiosk-style menu.

---

### US-2.1 — Browse the kiosk-style menu
**Priority:** Must · **Points:** 5 · **Release:** MVP

> **As a** customer, **I want** to browse all available items grouped by category, **so that** I can select what to order.

**Acceptance Criteria**
- **Given** I open the Menu page, **then** products are grouped by category in a self-order-kiosk layout (e.g. *Bakery*, *Main Course*).
- Each product card shows image, name, price and availability.
- **Given** a product is marked unavailable, **then** its card is visibly disabled and cannot be added to the cart.
- A sticky category navigation lets me jump between sections.
- The menu loads its data from the catalogue API and shows a loading state while fetching.

*Example layout:*
```
Bakery
  🍪 Chocolate Cookies   ₹150
  🍫 Brownie             ₹120
Main Course
  🍕 Farmhouse Pizza     ₹350
  🍔 Cheese Burger       ₹200
```

---

### US-2.2 — Search and filter products
**Priority:** Should · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to search and filter the menu, **so that** I can find a specific item quickly.

**Acceptance Criteria**
- **Given** I type in the search box, **then** the menu filters to matching product names/descriptions in real time (debounced).
- I can filter by category and by availability.
- **Given** no products match, **then** a friendly "no results" message is shown with a way to clear filters.
- Search/filter state is reflected in the URL so results can be shared/bookmarked.

---

### US-2.3 — View product details
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to view a product's details, **so that** I can decide before adding it to my cart.

**Acceptance Criteria**
- **Given** I select a product, **then** I see a detail view with large image, name, full description, price and availability.
- **When** I add the item from the detail view, **then** it is added to the cart with the chosen quantity and I receive visual confirmation.
- Where applicable, the detail view shows variants/options (e.g. size) and dietary tags (veg/non-veg, allergens).

---

## Epic E3 — Cart & Ordering

> **Goal:** Make assembling and reviewing an order effortless.

---

### US-3.1 — Add items to cart
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to add items to my cart, **so that** I can order multiple products together.

**Acceptance Criteria**
- **When** I add an item, **then** it appears in the cart and a cart badge shows the current item count.
- **Given** I add the same item again, **then** its quantity increments rather than creating a duplicate line.
- The cart persists across page reloads for the session (and across devices once authenticated).

---

### US-3.2 — Manage cart contents
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to change quantities and remove items, **so that** I can refine my order before checkout.

**Acceptance Criteria**
- I can increase/decrease the quantity of any line item and remove a line item entirely.
- **Given** I decrease quantity to zero, **then** the line item is removed (with an undo or confirmation).
- The cart recalculates subtotal, tax and total whenever contents change.
- **Given** the cart is empty, **then** an empty-cart state with a link back to the menu is shown.

*Example cart:*
```
Brownie  x2        ₹240
Burger   x1        ₹200
--------------------------
Subtotal           ₹440
Tax                ₹40
Total              ₹480
```

---

### US-3.3 — Accurate price, tax and total calculation
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to see a clear breakdown of subtotal, tax and total, **so that** I trust what I am charged.

**Acceptance Criteria**
- Subtotal equals the sum of (line price × quantity) for all items.
- Tax is calculated per the configured rate and shown as a separate line.
- The displayed total equals subtotal + tax (+ delivery fee where applicable).
- **Given** the cart is priced on the client, **then** the server re-validates all prices and the total at checkout; any mismatch blocks the order.

---

## Epic E4 — Authentication & Account

> **Goal:** Let customers sign in with minimal friction and keep their profile and addresses.

---

### US-4.1 — Sign in with Google
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to sign in with my Google account, **so that** I can authenticate quickly without a password.

**Acceptance Criteria**
- **Given** I choose "Continue with Google", **then** I complete Google OAuth and return authenticated.
- **Given** it is my first sign-in, **then** a user profile is created in MongoDB (name, email, googleId).
- **Given** I have signed in before, **then** my existing profile is matched by googleId/email (no duplicate account).
- A session/JWT is issued and the UI reflects my signed-in state.

---

### US-4.2 — Sign in with mobile number + OTP
**Priority:** Must · **Points:** 5 · **Release:** MVP

> **As a** customer, **I want** to sign in with my mobile number and a one-time password, **so that** I can authenticate without Google.

**Acceptance Criteria**
- **Given** I enter a valid mobile number, **when** I request an OTP, **then** an OTP is sent via SMS and I am prompted to enter it.
- **Given** I enter the correct OTP within its validity window, **then** I am signed in and a profile is created/matched by phone number.
- **Given** I enter an incorrect or expired OTP, **then** I see a clear error and can request a new code.
- OTP requests are rate-limited and the code expires (e.g. 5 minutes); a resend cooldown is enforced.

*Flow:* `Enter mobile → Receive OTP → Verify OTP → Signed in`

---

### US-4.3 — Authentication required before payment
**Priority:** Must · **Points:** 2 · **Release:** MVP

> **As a** customer, **I want** to be prompted to sign in before payment, **so that** my order is tied to my account.

**Acceptance Criteria**
- **Given** I am unauthenticated and proceed from cart toward payment, **then** I am redirected to sign in.
- **Given** I complete sign-in, **then** I return to checkout with my cart intact.
- **Given** I am unauthenticated, **then** I cannot reach the payment step by any route (enforced server-side, not just UI).

---

### US-4.4 — Manage saved addresses
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to add, edit and delete delivery addresses, **so that** I can check out faster next time.

**Acceptance Criteria**
- I can add an address (full address, area, city, pincode, landmark) and mark one as default.
- I can edit and delete saved addresses.
- **Given** I check out for home delivery, **then** I can pick a saved address or enter a new one.
- Address fields are validated (e.g. pincode format) before saving.

---

### US-4.5 — View and edit profile
**Priority:** Should · **Points:** 2 · **Release:** MVP

> **As a** customer, **I want** to view and update my profile, **so that** my contact details stay current.

**Acceptance Criteria**
- I can view my name, email and phone.
- I can update editable fields; changes persist to MongoDB and reflect immediately.
- **Given** I signed in via Google, **then** identity fields owned by Google are read-only and clearly indicated.

---

### US-4.6 — Sign out
**Priority:** Must · **Points:** 1 · **Release:** MVP

> **As a** customer, **I want** to sign out, **so that** my account is secure on shared devices.

**Acceptance Criteria**
- **When** I sign out, **then** my session/token is invalidated and protected pages become inaccessible.
- After sign-out I am returned to the home page in a signed-out state.

---

## Epic E5 — Checkout & Order Type

> **Goal:** Capture the right fulfilment details for dine-in, takeaway or delivery.

---

### US-5.1 — Choose order type
**Priority:** Must · **Points:** 5 · **Release:** MVP

> **As a** customer, **I want** to choose how I receive my order, **so that** the café fulfils it correctly.

**Acceptance Criteria**
- I can choose one of: **Dining**, **Takeaway**, **Home Delivery**.
- **Dining** captures customer name and optional table number.
- **Takeaway** captures name and phone number.
- **Home Delivery** captures full address, area, city, pincode and landmark (or a saved address).
- **Given** required fields for the chosen type are missing, **then** I cannot proceed and the missing fields are highlighted.
- **Given** Home Delivery is chosen, **then** any delivery fee is added to the total breakdown.

---

### US-5.2 — Review order before payment
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to review my full order before paying, **so that** I can confirm items, fulfilment and cost.

**Acceptance Criteria**
- The checkout summary shows line items, order type and fulfilment details, and the price breakdown (subtotal, tax, delivery fee, total).
- **When** I edit the cart from checkout, **then** the summary and totals update accordingly.
- **Given** an item became unavailable or its price changed since adding, **then** I am notified and must re-confirm before paying.

---

## Epic E6 — Payments

> **Goal:** Take payment securely via Stripe and reconcile it to the order.

---

### US-6.1 — Pay online with Stripe
**Priority:** Must · **Points:** 8 · **Release:** MVP

> **As a** customer, **I want** to pay securely online, **so that** my order is confirmed immediately.

**Acceptance Criteria**
- **Given** a confirmed order summary, **when** I proceed to pay, **then** I complete payment through Stripe using a supported method (credit/debit card, UPI and other Stripe-enabled methods for the region).
- **Given** payment succeeds, **then** the order is marked **paid**, a Payment record is stored (orderId, stripePaymentId, amount, status) and I am taken to the order-success page.
- **Given** payment fails or is cancelled, **then** the order is not confirmed, no charge is captured, and I can retry or change method.
- Card data is handled by Stripe (via Stripe Elements/Checkout); no raw card details touch our servers.
- The amount charged is computed/verified server-side from the validated cart, never trusted from the client.

---

### US-6.2 — Reliable payment confirmation (webhooks)
**Priority:** Must · **Points:** 5 · **Release:** MVP

> **As the** system, **I want** to confirm payments via Stripe webhooks, **so that** order status is correct even if the customer closes the browser.

**Acceptance Criteria**
- A Stripe webhook updates payment and order status on `payment_intent.succeeded` / failure events.
- Webhook signatures are verified; events are processed idempotently (no double-fulfilment on retries).
- **Given** the success redirect is lost but the webhook arrives, **then** the order still reaches **paid/confirmed**.

---

### US-6.3 — Payment receipt
**Priority:** Should · **Points:** 2 · **Release:** MVP

> **As a** customer, **I want** a receipt for my payment, **so that** I have proof of purchase.

**Acceptance Criteria**
- On success I see an itemised receipt with order ID, amount, payment method and timestamp.
- A receipt/confirmation is emailed (and/or available under "My Orders").

---

## Epic E7 — Order Management & Tracking

> **Goal:** Keep customers informed from placement to completion.

---

### US-7.1 — Order confirmation
**Priority:** Must · **Points:** 2 · **Release:** MVP

> **As a** customer, **I want** an order confirmation after paying, **so that** I know my order was received.

**Acceptance Criteria**
- The order-success page shows order ID, items, order type, fulfilment details, total and initial status **Placed**.
- The order is persisted to MongoDB linked to my user account.

---

### US-7.2 — Track order status
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to see my order's current status, **so that** I know when it will be ready.

**Acceptance Criteria**
- I can view status progressing through **Placed → Confirmed → Preparing → Ready → Completed**.
- The current stage is clearly highlighted on a progress indicator.
- **Given** the status changes server-side, **then** my view updates (on refresh, and ideally in near-real-time).

---

### US-7.3 — Order history
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to see my past and active orders, **so that** I can review or reorder.

**Acceptance Criteria**
- "My Orders" lists my orders newest-first with date, items summary, total and status.
- **When** I open an order, **then** I see its full details and payment status.
- **Given** I have no orders, **then** a helpful empty state with a link to the menu is shown.

---

### US-7.4 — Order status notifications
**Priority:** Should · **Points:** 3 · **Release:** MVP

> **As a** customer, **I want** to be notified when my order status changes, **so that** I don't have to keep checking.

**Acceptance Criteria**
- **Given** my order moves to **Ready** (and key prior stages), **then** I receive a notification (email/SMS; WhatsApp is future scope).
- Notifications include order ID and the new status.
- Notification failures are logged and retried without blocking order processing.

---

## Epic E8 — Admin Console *(Future Scope)*

> **Goal:** Give staff control over catalogue, orders and insights. Out of scope for MVP; captured for roadmap completeness.

> **📌 Expanded (2026-07-02):** This epic now has a full v1.1 backlog in [`ADMIN_USER_STORIES.md`](./ADMIN_USER_STORIES.md) (31 stories across epics A1–A10 with acceptance criteria, estimates and release slices). The stubs below are retained for traceability and map as follows: US-8.1 → Epic A4 · US-8.2 → A5 · US-8.3 → A2/A3 · US-8.4 → A6 · US-8.5 → A8 · US-8.6 → A1.

---

### US-8.1 — Manage products *(Future)*
> **As an** admin, **I want** to create, update and delete products, **so that** the menu stays accurate.
**AC:** CRUD on products with image upload, price, availability and category; changes reflect on the storefront; only authorised admins can access.

### US-8.2 — Manage categories *(Future)*
> **As an** admin, **I want** to manage categories, **so that** products are well organised.
**AC:** CRUD on categories; prevent deletion of a category that still has products (or reassign).

### US-8.3 — View and update orders *(Future)*
> **As an** admin, **I want** to view orders and advance their status, **so that** the kitchen and customers stay in sync.
**AC:** Filterable order list; update status through the defined lifecycle; customer-facing status and notifications update accordingly.

### US-8.4 — Manage customers *(Future)*
> **As an** admin, **I want** to view customers, **so that** I can support them.
**AC:** Searchable customer list with order history; respect privacy/PII handling rules.

### US-8.5 — Sales reports *(Future)*
> **As an** admin, **I want** sales reports, **so that** I can understand performance.
**AC:** Revenue and order metrics by date range and category; export to CSV.

### US-8.6 — Admin authentication & roles *(Future)*
> **As an** admin, **I want** secure role-based access, **so that** only staff can manage the platform.
**AC:** Separate admin auth; role-based authorisation enforced server-side; admin actions audited.

---

## Epic E9 — Platform, Non-Functional & Cross-Cutting

> **Goal:** Quality attributes that apply across the product.

---

### US-9.1 — Responsive, accessible UI
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** user, **I want** the site to work well on any device, **so that** I can order from phone, tablet or desktop.

**Acceptance Criteria**
- All public and customer pages are usable and visually correct at mobile, tablet and desktop breakpoints.
- Interactive elements are keyboard-accessible; colour contrast meets WCAG 2.1 AA.
- Images use responsive sizes and meaningful `alt` text.

---

### US-9.2 — Error handling & resilience
**Priority:** Must · **Points:** 3 · **Release:** MVP

> **As a** user, **I want** clear feedback when something goes wrong, **so that** I know what to do next.

**Acceptance Criteria**
- API/network failures show a friendly, non-technical message with a retry where sensible.
- Form validation errors are specific and shown inline.
- Unexpected server errors are logged with a correlation ID; users never see stack traces.

---

### US-9.3 — Security & data protection
**Priority:** Must · **Points:** 5 · **Release:** MVP

> **As a** stakeholder, **I want** the platform to handle data and access securely, **so that** customers and the business are protected.

**Acceptance Criteria**
- All traffic is over HTTPS; secrets/keys are stored in environment config, never in source.
- Authentication uses signed tokens/sessions with expiry; protected APIs verify identity and ownership (a customer can only access their own orders).
- Input is validated/sanitised server-side; protection against common web vulnerabilities (XSS, injection, CSRF) is in place.
- Payment handling is PCI-compliant by delegating card capture to Stripe.
- PII is stored only as needed and access is restricted.

---

### US-9.4 — Performance budget
**Priority:** Should · **Points:** 3 · **Release:** MVP

> **As a** visitor, **I want** the site to load quickly, **so that** I don't abandon it.

**Acceptance Criteria**
- Landing page reaches interactive quickly on a mid-range mobile (target Largest Contentful Paint ≤ 2.5s on a typical connection).
- 3D/animation assets are lazy-loaded and code-split so they never block first paint.
- Menu and images are paginated/lazy-loaded to avoid large initial payloads.

---

## 6. Backlog Summary (Traceability)

| ID | Title | Epic | Priority | Points | Release |
|----|-------|------|----------|--------|---------|
| US-1.1 | Hero landing section | E1 | Must | 3 | MVP |
| US-1.2 | Interactive 3D & scroll experience | E1 | Should | 8 | MVP |
| US-1.3 | Category showcase | E1 | Must | 3 | MVP |
| US-1.4 | About / Contact pages | E1 | Should | 2 | MVP |
| US-2.1 | Kiosk-style menu | E2 | Must | 5 | MVP |
| US-2.2 | Search and filter | E2 | Should | 3 | MVP |
| US-2.3 | Product details | E2 | Must | 3 | MVP |
| US-3.1 | Add items to cart | E3 | Must | 3 | MVP |
| US-3.2 | Manage cart contents | E3 | Must | 3 | MVP |
| US-3.3 | Price/tax/total calculation | E3 | Must | 3 | MVP |
| US-4.1 | Google sign-in | E4 | Must | 3 | MVP |
| US-4.2 | Mobile + OTP sign-in | E4 | Must | 5 | MVP |
| US-4.3 | Auth required before payment | E4 | Must | 2 | MVP |
| US-4.4 | Manage saved addresses | E4 | Must | 3 | MVP |
| US-4.5 | View/edit profile | E4 | Should | 2 | MVP |
| US-4.6 | Sign out | E4 | Must | 1 | MVP |
| US-5.1 | Choose order type | E5 | Must | 5 | MVP |
| US-5.2 | Review order before payment | E5 | Must | 3 | MVP |
| US-6.1 | Pay online with Stripe | E6 | Must | 8 | MVP |
| US-6.2 | Payment webhooks | E6 | Must | 5 | MVP |
| US-6.3 | Payment receipt | E6 | Should | 2 | MVP |
| US-7.1 | Order confirmation | E7 | Must | 2 | MVP |
| US-7.2 | Track order status | E7 | Must | 3 | MVP |
| US-7.3 | Order history | E7 | Must | 3 | MVP |
| US-7.4 | Status notifications | E7 | Should | 3 | MVP |
| US-8.1 | Manage products | E8 | — | — | Future |
| US-8.2 | Manage categories | E8 | — | — | Future |
| US-8.3 | View/update orders | E8 | — | — | Future |
| US-8.4 | Manage customers | E8 | — | — | Future |
| US-8.5 | Sales reports | E8 | — | — | Future |
| US-8.6 | Admin auth & roles | E8 | — | — | Future |
| US-9.1 | Responsive & accessible UI | E9 | Must | 3 | MVP |
| US-9.2 | Error handling & resilience | E9 | Must | 3 | MVP |
| US-9.3 | Security & data protection | E9 | Must | 5 | MVP |
| US-9.4 | Performance budget | E9 | Should | 3 | MVP |

**MVP scope:** 28 stories · ~95 story points.

---

## 7. Suggested MVP Release Slices

1. **Slice 1 — Browse & Cart:** US-1.1, US-1.3, US-2.1, US-2.3, US-3.1, US-3.2, US-3.3
2. **Slice 2 — Auth & Account:** US-4.1, US-4.2, US-4.3, US-4.4, US-4.6
3. **Slice 3 — Checkout & Pay:** US-5.1, US-5.2, US-6.1, US-6.2, US-7.1
4. **Slice 4 — Track & Polish:** US-7.2, US-7.3, US-7.4, US-1.2, US-2.2, US-1.4, US-4.5, US-6.3
5. **Cross-cutting (throughout):** US-9.1, US-9.2, US-9.3, US-9.4

---

## 8. Out of Scope for v1.0 (Roadmap)

AI recommendations · Loyalty points · Coupons · Subscription plans · WhatsApp notifications · Kitchen display system · Full admin dashboard (Epic E8) · Inventory management · Delivery-partner integration.

---

*End of document.*
