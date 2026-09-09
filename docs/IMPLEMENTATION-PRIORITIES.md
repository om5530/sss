# Implementation priorities

Reviewed against both story documents and the implementation on 2026-09-09.

Real phone login: Firebase integration now uses runtime web configuration, recent phone-token verification and production mock blocking. Provider credentials and live activation are still required; see [phone OTP setup](PHONE-OTP-SETUP.md). No live SMS has been sent.

| Priority | Work | Status |
|---|---|---|
| 1 | Revoke account sessions on logout (US-4.6, part of AS-1.4) | Implemented. All previously issued sessions for that account stop authenticating. Failed revocation is shown as an error and can be retried. |
| 1 | Prevent checkout from charging a changed price without review (US-3.3 / US-5.2) | Implemented. A reviewed quote is mandatory; the server compares all line prices/quantities and the price breakdown before reserving stock/coupons or creating an order. A mismatch returns a fresh summary for explicit acceptance. |
| 2 | Address editing, valid delivery details and Google identity protection (US-4.4 / US-4.5, part of US-5.1) | Implemented. Edit saved addresses, choose a default, validate fields and 6-digit Indian pincodes, prevent changes to Google-owned names/emails. |
| 2 | Admin inactivity expiry, unsaved-work warnings and customer deactivation (AS-1.4, AS-6.3) | Implemented. Server enforces a configurable 30-minute idle limit; product forms warn and preserve tab-local drafts; deactivation requires a reason, revokes sessions and blocks sign-in. |
| 2 | Notification retries and error correlation IDs (US-7.4, US-9.2 / AS-10.2) | Implemented email queue, bounded retries, provider idempotency, failure dashboard and request IDs. Production scheduler/provider verification remains. |
| 3 | Managed categories and menu ordering (AS-5.1 / AS-5.2) | Implemented creation, rename, reassignment, nonempty deletion protection and per-group menu ordering. Existing categories migrate to stable references. |
| 3 | Database-backed store settings (AS-9.1) | Implemented tax, delivery fee, daily IST hours and contact details at `/admin/settings`. INR only; multi-currency remains open. |
| 4 | Cross-device carts, search URL/filter improvements, cart removal undo | Open. |
| 4 | Audit/product filters and audited order exports | Open. |
| 4 | Report category labels, revenue/quantity ranking, enquiry unread badge | Implemented. Other reporting refinements remain open. |
| 5 | Editable homepage content, testimonials and FAQs | Open. |

## Store settings batch — 2026-09-09

- New quotes read database tax/delivery settings immediately. Existing orders retain their stored pricing; order validation reads the same settings snapshot for opening hours and pricing.
- Opening hours apply to both immediate and scheduled orders, including overnight windows. `00:00`–`24:00` means all day; equal values mean closed.
- Contact page and footer use stored address/phone/email; menu and checkout use stored hours. Storefront page entry refreshes shared shop data, and saving settings refreshes it in the same browser session. Already-open pages in other browsers refresh on navigation/reload.
- First connected read initializes settings from existing environment pricing/hours. Contact fields start blank for staff to configure. Later environment changes do not replace saved settings. Notification sender/recipient configuration is still separate.
- INR is the only editable currency option because product/order displays are rupee-based. AS-9.1 is not full multi-currency support. Concurrent settings editors currently use last-save-wins; conflict warnings and unsaved settings drafts remain follow-up work.
- Validation: all 31 backend tests pass, including settings access control, invalid inputs, immediate repricing, unchanged historical pricing and closed-store order rejection. Angular production build passes with the existing `qrcode` warning. This batch has not had a browser UI pass or production deployment.

## Validation of the first batch

- Backend: 22 tests pass, including new integration coverage for revoked bearer/cookie tokens, optional-auth ownership checks, stale/tampered/missing quotes, stock/coupon preservation, address validation/updates, and Google identity protection.
- Angular production build passes. Existing `qrcode` CommonJS optimization warning remains.
- Browser: tested initial changed-price acceptance, another price change after review, successful cash order after reconfirmation, invalid pincode feedback and saved-address editing. These used an isolated in-memory database with email/payment providers disabled.
- Live provider configuration, full mobile/accessibility QA and performance targets are not certified by these checks.

## Compatibility and scope

- `/orders` now requires `expectedQuote: { items, pricing }` from `/cart/price`. Deploy client and API together; older clients must refresh before placing orders.
- A quote is a comparison snapshot, not a price guarantee or inventory reservation. All stored amounts continue to come from fresh server pricing.
- Sign-out revokes sessions on all devices. Admin inactivity is tracked separately per token; background polling does not renew it.
- The live payment UI uses Razorpay. The original Stripe-only story should be reconciled with that product choice.
- Guest dine-in/takeaway remains supported; delivery still requires authentication.
- These batches do not complete every acceptance criterion in either story document. Unsaved-work protection currently covers product forms; broader form coverage remains.

## Second batch validation and deployment

- Backend: all 30 tests pass, including category migration/rename/reorder, unchanged product edit timestamps, account deactivation and blocked sign-in, idle timeout/activity, request IDs, durable retries, concurrent workers and lease recovery.
- Angular production build passes; the existing `qrcode` CommonJS warning remains.
- `ADMIN_IDLE_MINUTES` defaults to 30. Previously issued admin tokens older than that window require a fresh login on first use after deployment.
- Set `RESEND_API_KEY`, a verified `NOTIFY_FROM`, and `SHOP_EMAIL` for email delivery. Without a provider, notifications are skipped in mock mode.
- Queued emails get an initial post-response attempt via Vercel `waitUntil`; new notifications and the open admin console also process due work. Configure a scheduler to call `GET /api/jobs/notifications` with `Authorization: Bearer <CRON_SECRET>` for unattended retries. Each call processes at most three jobs; choose cadence/capacity for expected traffic. No live scheduler was configured in this task.
- Retries stop after eight attempts or a 23-hour retry window. Inspect provider logs before manually resending permanent/exhausted failures. Completed records expire after 30 days. Database enqueue failures are logged and do not undo an already-created order; a transactional event outbox remains a future reliability improvement.
- Provider behavior references: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Vercel post-response work](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
- Category rename updates menu/product/report labels through stable references, with legacy string fallback for unmigrated products. Report amounts continue to use stored order lines.
- No production deployment, real email send or live payment was performed.

## Reporting and inbox batch — 2026-09-09

- Best sellers can be ranked by revenue or quantity, selecting the top ten from all matching products. Renamed category labels resolve through current category references; archived product sales remain included. Existing paid/non-cancelled order filters and revenue formulas are retained.
- The admin navigation shows the number of new enquiries. It refreshes on entry, every 30 seconds, and immediately after successful status changes in the same session. Polling does not extend admin idle sessions and stops when the admin layout is destroyed.
- Added integration checks for ranking beyond the revenue top ten, renamed/archived categories, unchanged totals and admin-only unread counts.
- Verification: all 33 backend tests pass; Angular production build passes with the existing `qrcode` CommonJS warning.
- Remaining: audit filters, audited exports, broader report refinements, cross-device carts and editable content. Browser QA and deployment of this batch remain pending.
