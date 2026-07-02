# Admin User Stories — Bakery & Café Online Ordering Platform

**Project:** Bakery & Café Online Ordering Platform — Admin Console
**Stack:** MEAN (MongoDB · Express · Angular · Node.js)
**Document version:** 1.1
**Last updated:** 2026-07-02
**Status:** v1.1 core implemented (epics A1–A4, A6–A8, A10 — see `/admin`). Open: A5 (managed categories), A9 (settings & content), AS-6.3, AS-5.2.
**Companion document:** [`USER_STORIES.md`](./USER_STORIES.md) (customer-side backlog, epics E1–E9). This document expands **Epic E8 — Admin Console** into a full, actionable backlog for the **v1.1 (Admin Console) release**.

---

## 1. Purpose

The customer-facing storefront (v1.0 MVP) lets customers browse, order, pay and track. Today, staff have **no interface at all**: the only admin capability in the system is a single API endpoint (`PATCH /api/orders/:id/status`) that must be called by hand, the catalogue can only be changed by re-running a seed script, and there is no visibility into orders, customers or revenue.

This document defines the **Admin Console** backlog as epics and user stories with testable acceptance criteria, in the same format as `USER_STORIES.md`, suitable for direct import into Jira / Azure Boards.

Each story follows the standard agile template:

> **As a** \<role\>, **I want** \<capability\>, **so that** \<benefit\>.

Acceptance criteria use the **Given / When / Then** (Gherkin) style wherever behaviour is testable, and checklists for static requirements.

---

## 2. Conventions & Legend

| Field | Meaning |
|-------|---------|
| **ID** | Stable identifier, e.g. `AS-3.1` (Admin Story). Never reused. Old `US-8.x` stubs in `USER_STORIES.md` map to these (see §7). |
| **Priority** | MoSCoW — **M**ust / **S**hould / **C**ould / **W**on't (this release) |
| **Points** | Relative estimate (Fibonacci: 1, 2, 3, 5, 8, 13) |
| **Release** | `v1.1` (Admin Console release) or `v1.2` (fast-follow) |

### Personas / Roles

| Role | Description |
|------|-------------|
| **Admin** | Owner/manager. Full access to catalogue, orders, customers, payments, reports and settings. |
| **Kitchen Staff** | Staff fulfilling orders; primarily uses the live order queue. *For v1.1 this is the same `admin` role — a separate restricted `staff` role is future scope (see §9).* |
| **Customer** | Storefront user (defined in `USER_STORIES.md`); referenced where admin actions have customer-visible effects. |
| **System** | Automated/background behaviour (audit logging, notifications, reconciliation). |

### Existing technical baseline (what these stories build on)

- `User.role` already supports `'customer' | 'admin'`, and a `requireRole('admin')` middleware exists (`server/src/middleware/auth.js`).
- Order lifecycle: `placed → confirmed → preparing → ready → completed`, plus `cancelled`; every change is appended to `statusHistory` with an optional note (`server/src/models/Order.js`).
- Payment statuses: `pending | paid | failed | refunded`; payments go through Stripe with a mock mode when no keys are configured.
- Order types: `dining` (table number), `takeaway` (name + phone), `delivery` (address). **Dine-in and takeaway support guest checkout** — guest orders have no user account attached.
- Product fields: name, slug, group (`bakery | savoury`), category (currently a plain string — there is no Category collection), description, price, image URL, dietary (`veg | non-veg | egg`), tags, `available`, `featured`.
- The catalogue is currently seeded from `server/src/utils/seed.js`; product API routes are read-only; tax rate and delivery fee live in server `.env`.

### Definition of Ready / Definition of Done

The DoR and DoD in `USER_STORIES.md` §3–4 apply unchanged to every story in this document.

---

## 3. Epics Overview

| Epic | Title | Release |
|------|-------|---------|
| **A1** | Admin Access & Security | v1.1 |
| **A2** | Dashboard & Live Operations | v1.1 |
| **A3** | Order Management | v1.1 |
| **A4** | Product Catalogue Management | v1.1 |
| **A5** | Category & Menu Organisation | v1.1 |
| **A6** | Customer Management | v1.1 |
| **A7** | Payments & Refunds | v1.1 |
| **A8** | Reports & Insights | v1.1 |
| **A9** | Store Settings & Site Content | v1.2 |
| **A10** | Admin Non-Functional & Cross-Cutting | v1.1 |

---

## Epic A1 — Admin Access & Security

> **Goal:** Only authorised staff can reach the admin area, every admin action is attributable, and privileges can never be self-granted.

---

### AS-1.1 — Admin sign-in & role-gated access
**Priority:** Must · **Points:** 3 · **Release:** v1.1

> **As an** admin, **I want** to sign in with my existing account and be recognised as staff, **so that** I can access the admin console without a separate credential system.

**Acceptance Criteria**
- **Given** my user record has `role = 'admin'`, **when** I sign in via the existing phone-OTP or Google flow, **then** the navigation exposes an **Admin** entry and I can open `/admin`.
- **Given** my role is `customer`, **then** no admin entry is shown and navigating to `/admin` directly redirects me away with no information leak about what exists there.
- Admin role is granted **only server-side** (promotion script / seed / environment allowlist of phone numbers or emails). There is no UI or API through which a user can grant themselves or others the admin role in v1.1.
- **Given** an admin's role is revoked, **then** their next request to any admin API is rejected (role is checked per-request, not only at sign-in).

---

### AS-1.2 — Admin route & API protection
**Priority:** Must · **Points:** 3 · **Release:** v1.1

> **As a** stakeholder, **I want** every admin page and endpoint protected by role-based authorisation, **so that** customers and attackers cannot reach staff functionality.

**Acceptance Criteria**
- All `/admin/**` Angular routes are behind an auth + role guard; unauthenticated users are sent to sign-in, authenticated non-admins to the home page.
- Every admin API endpoint is protected server-side with the existing `requireRole('admin')` middleware — **the client-side guard is a convenience, never the enforcement**.
- **Given** a non-admin calls an admin endpoint with a valid customer token, **then** the API responds `403` without performing the action.
- **Given** an expired/invalid token, **then** the API responds `401` and the admin UI returns to sign-in preserving the intended destination.
- Admin routes and their JS bundles are lazy-loaded so storefront visitors never download admin code.

---

### AS-1.3 — Audit log of admin actions
**Priority:** Should · **Points:** 5 · **Release:** v1.1

> **As an** owner, **I want** every admin action recorded, **so that** changes to products, orders and refunds are attributable and disputes can be resolved.

**Acceptance Criteria**
- Every **mutating** admin action (product create/edit/delete, availability/featured toggle, order status change, cancellation, refund, customer deactivation, settings change) writes an audit entry: acting admin, action type, target entity + id, timestamp, and a before/after snapshot of changed fields.
- **Given** I open the audit log screen, **then** I can filter by admin, action type, entity and date range, newest-first, paginated.
- Audit entries are append-only: no API exists to edit or delete them.
- Audit writes must not block the underlying action; a failed audit write is logged as a server error and alerts, but does not roll back the admin's change.

---

### AS-1.4 — Admin session security
**Priority:** Must · **Points:** 2 · **Release:** v1.1

> **As a** stakeholder, **I want** admin sessions handled conservatively, **so that** a lost or shared device does not expose store management.

**Acceptance Criteria**
- Admin API responses send `Cache-Control: no-store` so no admin data is cached by browsers or proxies.
- **When** an admin signs out, **then** the session/token is invalidated server-side and `/admin` is no longer reachable with the old token.
- Admin sessions expire after a configurable inactivity window; expiry returns the user to sign-in without losing unsaved-work warnings.
- Rate limiting applies to admin endpoints at least as strictly as public ones.

---

## Epic A2 — Dashboard & Live Operations

> **Goal:** The counter/kitchen sees new orders the moment they arrive and can run the day from one screen.

---

### AS-2.1 — Operations dashboard
**Priority:** Must · **Points:** 5 · **Release:** v1.1

> **As an** admin, **I want** a dashboard summarising today's business at a glance, **so that** I can spot problems and load without digging through lists.

**Acceptance Criteria**
- **Given** I open `/admin`, **then** I see today's key metrics: order count, revenue (paid orders only), average order value, and a breakdown of active orders by status (`placed / confirmed / preparing / ready`).
- The dashboard shows the split of today's orders by type (dine-in / takeaway / delivery).
- A tile lists currently **unavailable** products so sold-out items are never forgotten overnight.
- Metrics are computed server-side from MongoDB (aggregation), not assembled in the browser from full data dumps.
- Each metric links to the corresponding filtered list (e.g. clicking "Preparing: 4" opens the order queue filtered to *preparing*).

---

### AS-2.2 — Live incoming-order feed
**Priority:** Must · **Points:** 5 · **Release:** v1.1

> **As** kitchen staff, **I want** new orders to appear on my screen automatically with an alert, **so that** nothing sits unnoticed while we work.

**Acceptance Criteria**
- **Given** the order queue is open, **when** a new order is **paid** (or placed, for pay-later flows if enabled), **then** it appears in the queue within seconds without a manual refresh (polling or SSE — implementation's choice, behaviour is what's tested).
- New orders trigger a sound and a visual highlight until acknowledged; sound can be muted per device.
- Each queue card shows: order number, elapsed time since placement, order type badge (dine-in with table number / takeaway with name / delivery with area), item summary and total.
- Guest orders (dine-in/takeaway without an account) display normally, labelled **Guest**.
- **Given** the connection drops, **then** the queue shows a reconnecting indicator and catches up on missed orders once restored — no silent staleness.

---

### AS-2.3 — Quick status actions from the queue
**Priority:** Must · **Points:** 3 · **Release:** v1.1

> **As** kitchen staff, **I want** to advance an order's status in one tap from the queue, **so that** keeping customers informed doesn't slow down service.

**Acceptance Criteria**
- Each queue card offers a single primary action for the **next** lifecycle step only (`placed → Confirm`, `confirmed → Start preparing`, `preparing → Mark ready`, `ready → Complete`).
- **When** I tap the action, **then** the status updates optimistically, the change is persisted via the status API, and the card moves to its new column/section.
- **Given** the update fails server-side, **then** the card reverts and an error toast explains what happened.
- Status changes made here appear in the order's `statusHistory` and drive the customer's tracker and notifications exactly as in US-7.2 / US-7.4.

---

## Epic A3 — Order Management

> **Goal:** Staff can find any order past or present, understand it fully, and manage its lifecycle including cancellation.

---

### AS-3.1 — Order list with filters & search
**Priority:** Must · **Points:** 5 · **Release:** v1.1

> **As an** admin, **I want** a filterable, searchable list of all orders, **so that** I can find any order in seconds.

**Acceptance Criteria**
- **Given** I open the orders screen, **then** I see all orders newest-first with order number, date/time, customer (or **Guest**), type, items count, total, payment status and order status.
- I can filter by order status, order type, payment status and date range; filters combine.
- I can search by order number, customer name or phone number.
- The list is paginated server-side; filters and search are query parameters so a view can be bookmarked/shared.
- **Given** no orders match, **then** an empty state offers to clear filters.

---

### AS-3.2 — Order detail view
**Priority:** Must · **Points:** 3 · **Release:** v1.1

> **As an** admin, **I want** the complete picture of a single order, **so that** I can answer any customer question about it.

**Acceptance Criteria**
- The detail view shows: line items (name, unit price, quantity, line total), the pricing breakdown (subtotal, tax, delivery fee, total — matching the order's stored `pricing`), payment record (method, Stripe payment id, payment status), and the customer/guest identity.
- The fulfilment block adapts to order type: table number + name for dine-in; name + phone for takeaway; full address, area, city, pincode, landmark for delivery.
- The full `statusHistory` renders as a timeline with timestamps and any notes.
- **Given** the order belongs to a registered customer, **then** their name links to the customer detail view (AS-6.2).

---

### AS-3.3 — Update order status with valid transitions
**Priority:** Must · **Points:** 3 · **Release:** v1.1

> **As an** admin, **I want** to move an order through its lifecycle with only legal transitions offered, **so that** the customer-facing tracker always tells a coherent story.

**Acceptance Criteria**
- From the order detail I can change status; the UI offers only valid moves — forward along `placed → confirmed → preparing → ready → completed`, or to `cancelled` from any non-final status.
- **Given** an order is `completed` or `cancelled`, **then** no further status change is offered, and the API rejects attempts (`400`) — terminal states are enforced server-side, not just hidden in the UI.
- I can attach an optional note to a status change; it is stored in `statusHistory` and visible in the timeline.
- **When** the status changes, **then** the customer's order tracking view reflects it (US-7.2) and status notifications fire (US-7.4).
- Every status change is audited (AS-1.3).

---

### AS-3.4 — Cancel an order
**Priority:** Must · **Points:** 3 · **Release:** v1.1

> **As an** admin, **I want** to cancel an order with a recorded reason, **so that** we can handle out-of-stock items, kitchen problems or customer requests cleanly.

**Acceptance Criteria**
- **Given** an order is not `completed` or `cancelled`, **then** I can cancel it; a reason is **mandatory** and is stored as the note on the `cancelled` status event.
- **Given** the order is **paid**, **when** I cancel it, **then** I am prompted to issue a refund (AS-7.2) as part of the same flow; I may defer, in which case the order is flagged as *cancelled — refund pending* until resolved.
- Cancellation requires an explicit confirmation step showing order number and total (AS-10.2).
- **Given** an order is cancelled, **then** the customer's view shows it as cancelled and a notification is sent.

---

## Epic A4 — Product Catalogue Management

> **Goal:** The menu is managed from a screen, not a seed script — prices, availability and featured items change in seconds.

---

### AS-4.1 — Product list & search
**Priority:** Must · **Points:** 3 · **Release:** v1.1

> **As an** admin, **I want** to see and search the whole catalogue, **so that** I can manage the menu efficiently.

**Acceptance Criteria**
- **Given** I open the products screen, **then** I see all products with thumbnail, name, group, category, price, dietary tag, availability and featured state.
- I can filter by group (`bakery`/`savoury`), category, dietary tag, availability and featured; and search by name.
- Unavailable products are visually distinct so sold-out items stand out.
- The list loads from an admin products API that returns **all** products (the public API may hide unavailable ones; the admin one must not).

---

### AS-4.2 — Create a product
**Priority:** Must · **Points:** 5 · **Release:** v1.1

> **As an** admin, **I want** to add a new product from a form, **so that** new bakes go on sale without a developer.

**Acceptance Criteria**
- The form captures every catalogue field: name, group, category, description, price, image URL, dietary tag, tags, available, featured.
- The slug is auto-generated from the name and guaranteed unique; a duplicate resolves automatically (suffix) or shows a clear inline error.
- All input is validated server-side (required fields, price ≥ 0, valid enum values); client-side validation mirrors it for fast feedback.
- **Given** I save a valid product, **then** it appears immediately on the storefront menu (and in the featured rail if marked featured), with an image preview shown before saving.
- Image is provided as a URL in v1.1; direct file upload (with storage + resizing) is noted as future scope.
- Creation is audited (AS-1.3).

---

### AS-4.3 — Edit a product
**Priority:** Must · **Points:** 3 · **Release:** v1.1

> **As an** admin, **I want** to edit any product, **so that** prices, descriptions and images stay accurate.

**Acceptance Criteria**
- All fields from AS-4.2 are editable with the same validation.
- **Given** I change a price, **then** new carts/orders use the new price, while already-placed orders are untouched — order line items are snapshots of name and price at purchase time.
- **Given** the cart re-pricing step (US-3.3) runs after my edit, **then** a customer holding the old price in their cart is re-priced/notified at checkout, never charged a stale price.
- Edits are audited with before/after values (AS-1.3).

---

### AS-4.4 — Toggle availability & featured
**Priority:** Must · **Points:** 2 · **Release:** v1.1

> **As** kitchen staff, **I want** one-tap toggles for *available* and *featured*, **so that** selling out mid-service takes two seconds to reflect online.

**Acceptance Criteria**
- The product list has inline toggles for `available` and `featured` — no need to open the edit form.
- **When** I mark a product unavailable, **then** its storefront card is disabled and it cannot be added to carts (US-2.1); checkout re-validation rejects it if already in a cart (US-5.2).
- **When** I toggle featured, **then** the homepage "Most-loved" rail updates accordingly.
- Toggles persist immediately with optimistic UI and revert on failure with an error toast.

---

### AS-4.5 — Delete or archive a product
**Priority:** Should · **Points:** 2 · **Release:** v1.1

> **As an** admin, **I want** to remove discontinued products safely, **so that** the menu stays current without corrupting order history.

**Acceptance Criteria**
- Removal is a **soft delete/archive**: the product disappears from the storefront and default admin list but remains in the database.
- Historical orders referencing an archived product still render fully (their line items are snapshots).
- Archiving requires confirmation; **given** the product is currently featured, **then** the confirmation warns it will leave the homepage rail.
- Archived products can be viewed via a filter and restored.
- Archive/restore actions are audited (AS-1.3).

---

## Epic A5 — Category & Menu Organisation

> **Goal:** Categories become managed data instead of free-typed strings, and the menu's structure is under staff control.

---

### AS-5.1 — Manage categories
**Priority:** Should · **Points:** 5 · **Release:** v1.1

> **As an** admin, **I want** to create, rename and delete categories, **so that** the menu stays well organised as the range evolves.

**Acceptance Criteria**
- Categories are managed as a first-class list (name, group `bakery`/`savoury`), replacing today's free-typed string on each product; product create/edit forms select from this list.
- **Given** existing products, **then** the current distinct category strings are migrated into the managed list without changing any product's classification.
- **When** I rename a category, **then** all its products reflect the new name on the storefront and in filters.
- **Given** a category still has products, **then** deletion is blocked with the option to reassign those products to another category first.
- Category changes are audited (AS-1.3).

---

### AS-5.2 — Order categories on the menu
**Priority:** Could · **Points:** 3 · **Release:** v1.2

> **As an** admin, **I want** to control the display order of categories, **so that** the menu leads with what sells.

**Acceptance Criteria**
- I can reorder categories (drag-and-drop or up/down controls) per group.
- The storefront menu sections and sticky category navigation follow the saved order.
- New categories default to the end of their group.

---

## Epic A6 — Customer Management

> **Goal:** Staff can look up any customer to support them, with PII handled respectfully.

---

### AS-6.1 — Customer list & search
**Priority:** Should · **Points:** 3 · **Release:** v1.1

> **As an** admin, **I want** to search customers by name, phone or email, **so that** I can find the right account while they're on the phone.

**Acceptance Criteria**
- The customer list shows name, phone, email, sign-up date, order count and last-order date, paginated and searchable by name / phone / email.
- Only admins can access the list (AS-1.2); customer PII never appears in URLs or logs.
- No payment card data is shown anywhere — card details live with Stripe only.
- **Given** a customer has no orders, **then** they still appear with an order count of 0.

---

### AS-6.2 — Customer detail with order history
**Priority:** Should · **Points:** 3 · **Release:** v1.1

> **As an** admin, **I want** a customer's profile and complete order history in one place, **so that** I can resolve support requests quickly.

**Acceptance Criteria**
- The detail view shows profile fields (name, phone, email, sign-in method), saved addresses, and all orders newest-first with status and totals.
- A lifetime-value summary (total spent across paid orders, order count) is shown.
- Each order links to its admin order detail (AS-3.2).
- Admin cannot edit customer profile fields in v1.1 (support-driven edits are future scope) — view only, except AS-6.3.

---

### AS-6.3 — Deactivate a customer account
**Priority:** Could · **Points:** 2 · **Release:** v1.2

> **As an** admin, **I want** to deactivate an abusive account, **so that** the platform is protected from misuse.

**Acceptance Criteria**
- **When** I deactivate an account (reason mandatory), **then** the customer can no longer sign in or place orders; existing orders are unaffected and still fulfilled/refunded per policy.
- Deactivation is reversible; both actions are audited (AS-1.3).
- **Given** a deactivated customer attempts to sign in, **then** they see a neutral message directing them to contact the café — no technical detail.

---

## Epic A7 — Payments & Refunds

> **Goal:** Every rupee is traceable to an order, and refunds are handled inside the console, not the Stripe dashboard.

---

### AS-7.1 — Payments overview
**Priority:** Should · **Points:** 3 · **Release:** v1.1

> **As an** admin, **I want** to see all payment records and their reconciliation state, **so that** I can trust that orders and money match.

**Acceptance Criteria**
- The payments screen lists payment records with order number (linked), amount, currency, method, Stripe payment id, status (`pending / paid / failed / refunded`) and timestamp; filterable by status and date range.
- **Given** an order is marked paid by redirect but its webhook confirmation (US-6.2) has not arrived, **then** it is flagged for attention.
- Mock-mode payments (no Stripe keys configured) are visually labelled as mock so test data is never mistaken for revenue.

---

### AS-7.2 — Issue a refund
**Priority:** Should · **Points:** 5 · **Release:** v1.1

> **As an** admin, **I want** to refund a paid order from the console, **so that** cancellations and complaints are resolved without leaving the system.

**Acceptance Criteria**
- **Given** an order's payment status is `paid`, **then** I can issue a **full refund**; a reason is mandatory.
- **When** the refund is confirmed, **then** the refund is executed via the Stripe API (mock mode simulates success), the payment record and order `paymentStatus` become `refunded`, and the customer's order view reflects it.
- Refunds require an explicit confirmation showing order number and amount (AS-10.2), and are always audited with the acting admin and reason (AS-1.3).
- **Given** the Stripe refund fails, **then** no local state changes to `refunded`, and the error is surfaced with a retry option.
- Refunds are idempotent — repeating a refund request for an already-refunded order is rejected cleanly.
- Partial refunds are out of scope for v1.1 (noted for roadmap).

---

## Epic A8 — Reports & Insights

> **Goal:** The owner understands performance without exporting the database.

---

### AS-8.1 — Sales report by date range
**Priority:** Should · **Points:** 5 · **Release:** v1.1

> **As an** owner, **I want** revenue and order metrics over any date range, **so that** I can track how the business is doing.

**Acceptance Criteria**
- **Given** I pick a date range (with presets: today, last 7 days, this month, custom), **then** I see total revenue, order count and average order value for **paid** orders only — cancelled and refunded orders are excluded from revenue and shown separately.
- Results can be grouped daily, weekly or monthly, rendered as a simple trend chart plus a table.
- Figures are computed server-side via aggregation; the endpoint is admin-only.
- Timezone is the store's local timezone (IST), applied consistently so "today" matches the shop's day.

---

### AS-8.2 — Product & category performance
**Priority:** Should · **Points:** 3 · **Release:** v1.1

> **As an** owner, **I want** to see what sells, **so that** I can plan the menu and daily bakes.

**Acceptance Criteria**
- For a chosen date range I can see top products by quantity and by revenue, revenue by category, and the dine-in / takeaway / delivery split.
- Only paid orders count; product rows link to the product edit screen (AS-4.3).
- **Given** a product was archived (AS-4.5), **then** its historical sales still appear, labelled as archived.

---

### AS-8.3 — Export to CSV
**Priority:** Could · **Points:** 2 · **Release:** v1.2

> **As an** owner, **I want** to export orders and sales data as CSV, **so that** I can share it with my accountant.

**Acceptance Criteria**
- From the sales report and order list I can export the current filtered range as CSV (UTF-8, headers, one row per order / per report row).
- Exports respect the active filters and date range exactly — what I see is what I get.
- The export endpoint is admin-only and audited (AS-1.3).

---

## Epic A9 — Store Settings & Site Content

> **Goal:** Everything currently hardcoded — tax rate, delivery fee, hours, testimonials, FAQs — becomes manageable by the store, not a developer.

---

### AS-9.1 — Store settings
**Priority:** Could · **Points:** 3 · **Release:** v1.2

> **As an** admin, **I want** to manage store-level settings, **so that** operational changes don't require a deployment.

**Acceptance Criteria**
- A settings screen manages: tax rate, delivery fee, currency, opening hours, contact address / phone / email.
- Settings move from `.env` / hardcoded markup into the database; the pricing service reads tax rate and delivery fee from settings, and the storefront contact page renders the stored details.
- **When** I change the tax rate or delivery fee, **then** new pricing calculations use the new values immediately; existing orders keep their stored pricing.
- Setting changes are audited with before/after values (AS-1.3).

---

### AS-9.2 — Manage testimonials & FAQs
**Priority:** Could · **Points:** 3 · **Release:** v1.2

> **As an** admin, **I want** to edit the homepage testimonials and FAQs, **so that** the site shows real, current customer voices and answers.

**Acceptance Criteria**
- CRUD for testimonials (name, quote, rating/context) and FAQs (question, answer, display order), replacing the arrays currently hardcoded in the home page component.
- The storefront homepage renders these from the API with a sensible fallback if none exist.
- Changes appear on the storefront without a rebuild/redeploy.

---

### AS-9.3 — Contact-form inbox
**Priority:** Could · **Points:** 3 · **Release:** v1.2

> **As an** admin, **I want** contact-form messages collected into an inbox, **so that** enquiries are never lost.

**Acceptance Criteria**
- A contact API endpoint is added and the storefront contact form (currently a demo stub that submits nowhere) is wired to it, with validation and spam protection (honeypot/rate limit) per US-1.4.
- The admin inbox lists messages (name, email, message, received time) newest-first, with unread/read and mark-as-handled states.
- **Given** a new message arrives, **then** an unread badge appears in admin navigation.

---

## Epic A10 — Admin Non-Functional & Cross-Cutting

> **Goal:** The console is fast, safe and comfortable to use during a rush — including on the kitchen tablet.

---

### AS-10.1 — Responsive admin, tablet-first for the queue
**Priority:** Must · **Points:** 2 · **Release:** v1.1

> **As** kitchen staff, **I want** the admin console to work well on a tablet, **so that** the order queue can live next to the oven, not in the office.

**Acceptance Criteria**
- All admin screens are usable at desktop and tablet breakpoints; the order queue (A2) is explicitly designed for tablet use with large touch targets.
- Data tables collapse gracefully on narrow screens (priority columns, expandable rows) rather than requiring horizontal scrolling for core actions.
- Interactive elements are keyboard-accessible and meet WCAG 2.1 AA contrast, consistent with US-9.1.

---

### AS-10.2 — Error handling & safety rails
**Priority:** Must · **Points:** 2 · **Release:** v1.1

> **As an** admin, **I want** destructive actions confirmed and failures explained, **so that** a rushed tap can't corrupt live orders or the menu.

**Acceptance Criteria**
- Destructive or money-moving actions (cancel order, refund, archive product, delete category, deactivate customer) always require an explicit confirmation that names the target and consequence.
- Failed API calls show a specific, non-technical message with a retry where sensible; optimistic UI always reverts on failure.
- **Given** two admins edit the same product concurrently, **then** the second save is detected (e.g. version/timestamp check) and the admin is warned before overwriting.
- Server errors are logged with correlation IDs consistent with US-9.2; admins never see stack traces.

---

## 7. Backlog Summary (Traceability)

| ID | Title | Epic | Priority | Points | Release | Supersedes |
|----|-------|------|----------|--------|---------|------------|
| AS-1.1 | Admin sign-in & role-gated access | A1 | Must | 3 | v1.1 | US-8.6 |
| AS-1.2 | Admin route & API protection | A1 | Must | 3 | v1.1 | US-8.6 |
| AS-1.3 | Audit log of admin actions | A1 | Should | 5 | v1.1 | US-8.6 |
| AS-1.4 | Admin session security | A1 | Must | 2 | v1.1 | US-8.6 |
| AS-2.1 | Operations dashboard | A2 | Must | 5 | v1.1 | — |
| AS-2.2 | Live incoming-order feed | A2 | Must | 5 | v1.1 | US-8.3 |
| AS-2.3 | Quick status actions from the queue | A2 | Must | 3 | v1.1 | US-8.3 |
| AS-3.1 | Order list with filters & search | A3 | Must | 5 | v1.1 | US-8.3 |
| AS-3.2 | Order detail view | A3 | Must | 3 | v1.1 | US-8.3 |
| AS-3.3 | Update order status (valid transitions) | A3 | Must | 3 | v1.1 | US-8.3 |
| AS-3.4 | Cancel an order | A3 | Must | 3 | v1.1 | US-8.3 |
| AS-4.1 | Product list & search | A4 | Must | 3 | v1.1 | US-8.1 |
| AS-4.2 | Create a product | A4 | Must | 5 | v1.1 | US-8.1 |
| AS-4.3 | Edit a product | A4 | Must | 3 | v1.1 | US-8.1 |
| AS-4.4 | Toggle availability & featured | A4 | Must | 2 | v1.1 | US-8.1 |
| AS-4.5 | Delete or archive a product | A4 | Should | 2 | v1.1 | US-8.1 |
| AS-5.1 | Manage categories | A5 | Should | 5 | v1.1 | US-8.2 |
| AS-5.2 | Order categories on the menu | A5 | Could | 3 | v1.2 | US-8.2 |
| AS-6.1 | Customer list & search | A6 | Should | 3 | v1.1 | US-8.4 |
| AS-6.2 | Customer detail with order history | A6 | Should | 3 | v1.1 | US-8.4 |
| AS-6.3 | Deactivate a customer account | A6 | Could | 2 | v1.2 | US-8.4 |
| AS-7.1 | Payments overview | A7 | Should | 3 | v1.1 | — |
| AS-7.2 | Issue a refund | A7 | Should | 5 | v1.1 | — |
| AS-8.1 | Sales report by date range | A8 | Should | 5 | v1.1 | US-8.5 |
| AS-8.2 | Product & category performance | A8 | Should | 3 | v1.1 | US-8.5 |
| AS-8.3 | Export to CSV | A8 | Could | 2 | v1.2 | US-8.5 |
| AS-9.1 | Store settings | A9 | Could | 3 | v1.2 | — |
| AS-9.2 | Manage testimonials & FAQs | A9 | Could | 3 | v1.2 | — |
| AS-9.3 | Contact-form inbox | A9 | Could | 3 | v1.2 | — |
| AS-10.1 | Responsive admin (tablet-first queue) | A10 | Must | 2 | v1.1 | — |
| AS-10.2 | Error handling & safety rails | A10 | Must | 2 | v1.1 | — |

**v1.1 scope:** 25 stories · 86 points (16 Must / 9 Should).
**v1.2 fast-follow:** 6 stories · 16 points.
Every original E8 stub (US-8.1 – US-8.6) is covered by at least one AS story above.

---

## 8. Suggested Release Slices

1. **Slice 1 — Foundation & Orders:** AS-1.1, AS-1.2, AS-1.4, AS-3.1, AS-3.2, AS-3.3, AS-3.4 — *staff can securely see and manage every order.*
2. **Slice 2 — Live Operations:** AS-2.1, AS-2.2, AS-2.3, AS-10.1 — *the kitchen runs the day from the queue.*
3. **Slice 3 — Catalogue:** AS-4.1, AS-4.2, AS-4.3, AS-4.4, AS-4.5, AS-5.1 — *the menu is managed without the seed script.*
4. **Slice 4 — Money & Customers:** AS-7.1, AS-7.2, AS-6.1, AS-6.2, AS-8.1, AS-8.2 — *refunds, support and reporting.*
5. **Cross-cutting (throughout):** AS-1.3, AS-10.2.
6. **v1.2 fast-follow:** AS-5.2, AS-6.3, AS-8.3, AS-9.1, AS-9.2, AS-9.3.

---

## 9. Out of Scope for v1.1 (Roadmap)

Separate restricted **staff/kitchen role** (v1.1 uses a single `admin` role) · Direct image upload with storage & resizing · Partial refunds · Support-driven customer profile edits · Inventory/stock counts & low-stock alerts · Coupons & promotions management · Push notifications to staff devices · Multi-location support · Kitchen display system (dedicated KDS hardware mode) · Delivery-partner assignment & tracking.

---

*End of document.*
