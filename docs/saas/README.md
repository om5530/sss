# SaaS implementation checkpoint

Work branch: `saas/foundation`, based on main commit `bcc47a7`. Angular + Express remain in place. The Next.js rewrite and More Tools expansion are deferred.

## Implemented locally

- Dedicated local owner/staff signup, cookie sessions, confirmed password changes, session revocation and reviewed bakery creation (`owner-accounts.md`). Local single-use password recovery and encrypted verification previews are documented in `owner-recovery.md`; real email ownership/recovery delivery remain pending.
- Bakery profiles, typed owner/staff memberships, fresh authorization and no global-admin bypass.
- Expiring one-time staff invitations, reviewed acceptance, scoped team management/revocation and private member lists (`team.md`). Codes are never sent through URL parameters, and the app sends no invitations automatically.
- Owner-reviewed, tenant-scoped local logo/product-image uploads, normalized WebP storage, versioned publication-gated image routes and bounded quotas (`media.md`). Production object storage remains pending.
- Tenant catalogue creation, editing, archive/restore, bounded search/pagination and integer-paise pricing.
- Immutable stock-count history for opening counts, owner adjustments, tracking changes, completed production and sale consumption, with owner-only catalogue history (`stock-history.md`).
- Owner-only material inventory, receipts, measured count corrections, raw-material wastage and atomic production consumption. Finished-product wastage reduces stock and contributes saved cost estimates to selected event reports (`inventory-wastage.md`).
- Owner-only completed production runs with authoritative batch review, immutable recipe-cost snapshots, atomic stock additions, usage ceilings and reload-safe retries (`production.md`).
- Owner-only materials, pack pricing, Decimal costing, immutable recipe revisions and explicit product mapping (`recipes.md`).
- Event/manual sales, stock transactions, price review, per-bakery numbering, idempotent retries, historical cost snapshots and received-payment confirmation (`sales.md`).
- Owner-only discount corrections, immutable payment/correction histories, balance-preserving receipt/refund records and separately reported money received/dues/refunds owed (`sales.md`). Refund entry records money already returned manually.
- Development counter UI with confirmation dialogs, durable actor/bakery-scoped sale and manual-refund retry recovery and owner-only event finance reveal. Finances hide on event, bakery and page-visibility changes.
- Reviewed pickup readiness/collection milestones, separate from payment, with paid-only handover and idempotent forward transitions (`pickup.md`).
- Reviewed unpaid pickup cancellation, bounded request-driven expiry, stock returns with count-epoch safeguards and owner recount exceptions (`reservations.md`). No scheduler or paid-return automation.
- Confirmed customer password changes, single-use reset tokens, scoped session revocation and encrypted local mail/verification previews (`customer-security.md`). No real email is sent and preview completion does not verify ownership.
- Bakery-specific password accounts, HttpOnly scoped sessions, unpaid pickup checkout, private customer histories, account-bound requests and durable order retries (`customers.md`). Customer identity never grants staff/global-admin access.
- Version-checked profile settings, bakery-specific colour themes/text brand marks with unsaved/review previews, and an explicitly owner-enabled anonymous local menu preview. Public responses omit stock counts, recipe mappings, costs, owner identity and finance data (`storefront.md`).
- Offline legacy-data preflight, product conversion previews and reconciliation. These use synthetic fixtures, preserve source checksums/snapshots and have no apply mode (`migration.md`).
- Isolated Razorpay test subscription checkout/recovery, signed durable webhook inbox, fetched invoice/payment proof, cancellation and a bounded local worker (`billing.md`). Real sandbox credentials/acceptance and live rollout remain pending.
- Local unpriced plan fixtures, trial/active/grace/restricted access, plan-aware limits, owner plan/history views and a guarded dry-run-first local operator command (`subscriptions.md`). Live billing remains disabled; separate test integration is documented in `billing.md`.
- Canonical local bakery URLs, owner link generation/copying, loopback Host checks and offline synthetic rehearsal configuration (`routing-and-rehearsal.md`).
- A connected two-bakery API rehearsal with dedicated accounts, production, pickup, event bookkeeping, recovery and plan/revocation boundaries (`rehearsal-results.md`). It uses only disposable synthetic data; browser/staging acceptance remains pending.
- A synthetic cold backup/restore rehearsal: encrypted BSON-aware archives, persistent collection/index fidelity, rollback/target-safety checks and restored API checks with session/publication holds (`backup-restore-rehearsal.md`). No production backup or restore operator path is enabled.
- Server-owned development usage ceilings, atomic capacity checks and an owner-only usage snapshot under Menu settings (`usage.md`). Existing payments/corrections remain available at creation limits.
- Atomic security audit metadata and repeatable server/client checks, including client checks in CI.

## Production boundary

No production database access, migrations, backfills, deployment or production environment changes were performed.

The new APIs default off. They require `SAAS_FOUNDATION_ENABLED=true`, NODE_ENV development/test, no Vercel environment, and a connected loopback MongoDB replica set named `saas_<name>`. Cloud databases and other names are blocked before SaaS models load. Disabled startup does not register SaaS models and cannot auto-create their collections/indexes on a legacy connection.

New business records use shared `saas_*` collections with required bakery keys. They are separate from legacy collections because legacy callers remain unscoped. Bakery ownership does not grant legacy global admin access. Do not treat the legacy storefront/admin as tenant-isolated or onboard production customers into this prototype.

`vercel.json` disables automatic deployment of the exact `saas/foundation` branch; other branches retain existing defaults. Reference: https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled

## Local workspace

With a dedicated disposable local replica set and the development flag enabled, create or sign in to a dedicated account at `/saas-account`, then open `/saas-lab`. Legacy login is not required. Owners have Products, Recipes & materials, Inventory, Production, Counter & events, Menu settings and Team tabs. Signed-in staff can join by reviewing an owner-issued code. Staff have operational product/sales access, without recipe costs, event expenses or reports. A published local profile can be previewed anonymously at `/b/:slug` (older `/saas-menu/:slug` links redirect). Owners can separately enable local pickup ordering there; customer accounts remain bakery-specific and unverified. All SaaS UI routes are excluded in production builds.

Opening hours are display text. Recorded profit includes entered finished-product wastage estimates, excludes unrecorded losses/raw-material wastage/prepared/reusable stock, and remains unknown when saved sold-item or wastage costs are missing. Real email delivery/verified recovery, gateway payments/refunds, scheduled reservation cleanup, paid-order returns and inventory-lot valuation remain unimplemented; manual bookkeeping does not move money.

## Validation

- Server: `MONGOMS_VERSION=7.0.14 npm run test:saas` from server. Suites use generated loopback memory databases and ignore external MONGODB_URI. Offline tests use JSON fixtures only.
- Client: `npm run test:unit` from client. Temporary compiled test files are removed afterward.
- Build: `NG_CLI_ANALYTICS=false npm run build:client` from the root. CLI analytics are disabled in this branch.

Latest server validation: the full 346-check suite passed, including six cold backup/restore checks and the connected API rehearsal. The last frontend checkpoint passed 172 client unit/startup checks and the Angular development build. The normal production build was blocked by Google Fonts returning HTTP 403; an optimized production compilation with only font inlining temporarily disabled passed, and the original Angular configuration was restored. The existing qrcode CommonJS warning remains. Browser visual QA remains pending because the runner has no working browser binary. No visual pass is claimed.

## Deferred TODO

Monitoring and additional abuse controls are postponed at the user's request. Revisit when the user is ready; do not automatically resume this milestone. Existing local safeguards remain enabled. Details are tracked in `launch-readiness.md`.

## Delivery and remaining work

Changes are on the isolated local branch. Automatic approval review rejected source upload to GitHub, including after verifying the existing repository/owner. No remote branch was created. Explicit approval is needed before retrying that upload; preserve the deployment block.

Next: real email delivery/verified ownership, production identity/session configuration and real owner recovery delivery, payment-provider routing, real subscription billing and a staging-only rollout. The current remaining scope is tracked in `launch-readiness.md`; pickup milestones are documented in `pickup.md`. Lot valuation, returns/reversals and reconciliation remain later inventory work. Review image/tag/review/category/tombstone import policies before any apply path. Complete cross-module isolation, production session/identity configuration and operational/visual checks before considering a production migration.
