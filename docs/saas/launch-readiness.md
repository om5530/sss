# SaaS launch readiness

Current code is a guarded local prototype on `saas/foundation`, retaining Angular + Express. Passing unit/API checks and a production compilation do not make it a publicly launched SaaS. No production data migration, deployment or customer onboarding is authorized by this checkpoint.

## Available locally

- Dedicated local workspace accounts, reviewed bakery creation, scoped owner/staff access, invitations and revocation (`owner-accounts.md`). Account settings include session metadata, confirmed password changes and single-use local recovery/verification previews (`owner-recovery.md`).
- Product catalogue, immutable recipe revisions and product mapping.
- Production, material counts, stock history and recorded wastage.
- Counter/event orders, manual payment/correction/refund bookkeeping and private cost reporting.
- Confirmed password changes, token reset/session revocation and encrypted local verification previews (`customer-security.md`); real email ownership remains unverified.
- Owner-reviewed local logo/product images with normalized bounded storage and publication-gated routes (`media.md`).
- Local menu profiles with bakery-specific colour themes/text brand marks, bakery-specific customer accounts and unpaid pickup checkout (`storefront.md`).
- Safe cancellation, bounded request-driven reservation cleanup, readiness and collection tracking.
- Local draft plan/access states, plan-aware limits and operator history (`subscriptions.md`); separate Razorpay test billing is wired (`billing.md`), with real sandbox acceptance/live billing pending.
- Canonical local URLs and offline rehearsal preflight, plus a connected two-bakery synthetic API journey (`routing-and-rehearsal.md`, `rehearsal-results.md`); browser/hosted staging acceptance remains pending.
- Synthetic cold backup/restore with encrypted archive integrity, index/data comparisons and restored application/session checks (`backup-restore-rehearsal.md`); managed/offsite backups and production recovery acceptance remain pending.
- Development usage ceilings, audit metadata and automated regression checks.

## Deferred TODO — user decision

Monitoring and additional abuse controls are deferred until the user has time to revisit them. Do not start this milestone automatically when continuing other SaaS work.

- Error/performance monitoring, redacted operational logs and alerts.
- Shared durable rate limits and additional login, recovery, order and upload abuse protections.

Existing local protections remain in place. The launch-readiness requirements below remain open; this deferral does not mark them complete.

## Required before an externally usable pilot

| Area | Remaining implementation or evidence |
|---|---|
| Bakery owner onboarding and identity | Dedicated local owner/staff accounts and reviewed bakery creation now work without legacy login. Production TLS/host/session policy, real contact verification and owner recovery delivery, suspension/support and browser onboarding validation remain. |
| Tenant hosting and branding | Local path previews now have isolated colour themes, text marks and reviewed logo/product images. Production object storage/upload processing, reviewed hosted tenant URL/host resolution, public production storefront/admin entry points and secure cookie/domain configuration remain. |
| Customer accounts, if public checkout is enabled | Connect real email delivery/verification, delivery retry/bounce handling and durable abuse controls; define retention/export/deletion policy. Password change/reset and scoped session revocation now work locally, with encrypted operator previews; current email identifiers remain unverified. |
| Operational security | Cross-module isolation review, shared rate limiting, secure configuration/secrets, redacted monitoring/error reporting, managed/offsite backups and production restore acceptance (a synthetic cold restore rehearsal now passes), tenant suspension and scheduled expiry execution. |
| Usability and release validation | Real-browser end-to-end flows, mobile/iPad landscape QA, accessibility, concurrency/load checks, separate staging with synthetic data, deployment rollback and restore rehearsal. |
| Controlled rollout and existing bakery data | Decide migration scope, resolve import policies, implement idempotent apply/reconciliation and prove dry-run/rollback on disposable copies before considering any existing data. Existing migration tooling is preview-only. New-bakery pilots need not migrate legacy records. |

## Required for a paid SaaS offering

| Area | Remaining implementation or decision |
|---|---|
| Plans and entitlements | Finalize commercial prices/limits and account-wide policies. Local trial/active/grace/restricted access, data-preserving downgrade limits and an operator command now exist (`subscriptions.md`); production entitlement provisioning and billing integration remain. |
| Subscription billing | Razorpay test checkout/linkage, durable signed webhook intake, invoice/payment reconciliation and period-end cancellation are implemented (`billing.md`). Dedicated test account credentials, real sandbox acceptance, final pricing/tax policy, mid-period changes and production scheduled processing/live rollout remain. |
| Platform operations | Platform support/audit workflows with tightly scoped access, account recovery/suspension policies, billing support and customer-facing service/privacy/retention documentation. |

## Optional for the first pilot

- Customer online payment and automatic refund routing: pay-at-collection remains a valid pilot scope. Gateway money movement needs provider credentials, verification and reconciliation before enabling it.
- Paid-order cancellation and physical returns, partial collection, deliveries, order scheduling and tax/invoicing extensions depend on the offered business workflow.
- Inventory lots, actual purchase valuation, event allocations and full profit accounting are advanced inventory work; current recorded costs are estimates and explicitly labelled.
- Custom domains can follow a fixed tenant URL pilot. Automated self-service subscription checkout can follow a deliberately managed free pilot, but is needed for the proposed paid self-service service.

More Tools, a Next.js rewrite and face-recognition privacy controls remain deferred. They are not prerequisites for the initial SaaS pilot.

## Release boundary

Keep SaaS development separate from the existing Golden Batch production app/data. Current guards deliberately block Vercel/cloud databases and production UI routes. Changing that boundary requires a separately reviewed staging configuration and rollout. Do not remove these protections to demonstrate the prototype.

The code checkpoint is local only. Source upload was previously rejected by automatic approval review; no remote publish should be inferred from a local commit. No percentage or remaining session count is asserted: provider decisions and real staging/browser evidence are still outstanding.
