# Bakery-specific customer accounts and pickup ordering

The local menu preview now supports separate customer accounts for each bakery and unpaid pickup checkout. Owners must explicitly enable **Accept local pickup orders** in Menu settings, in addition to publishing the menu. The default is off; existing settings read as disabled without a backfill.

## Identity and sessions

`saas_customers` has a unique `(bakeryId, email)` key. Email is normalized for login within that bakery. The same email may have different names/passwords and independent account IDs at two bakeries. These accounts do not reuse or create legacy `User` records, receive global roles or become staff members. A legacy admin JWT is not customer authentication.

Passwords use the versioned `scrypt-v1` encoding, a random 16-byte salt, N=16384/r=8/p=1, a 64-byte derived key and timing-safe comparison. Login performs a dummy derivation for unknown accounts. Passwords are bounded to 12–128 characters/512 UTF-8 bytes. Password hashes are excluded from ordinary model selection and all controller responses. The UI clears passwords from form state and never stores them in order recovery.

The current email is a login identifier, not proof of email ownership: `emailVerified` remains false. No verification email, SMS or password-reset message is sent. Local reset tokens, confirmed password changes and encrypted verification-flow previews are available in `customer-security.md`; real email delivery/ownership verification must still be configured before onboarding production customers; these records must not be merged into verified legacy/global identities by email matching.

Sign-in issues a random 256-bit session cookie. Only its SHA256 digest is stored in `saas_customer_sessions`. Cookies are HttpOnly, host-only, SameSite=Strict, and scoped to the specific bakery’s customer API path/name. They expire after 12 hours. Database expiry is checked on every request; TTL cleanup is not the authorization boundary. Active customer state and session version are checked again inside write transactions.

At most five sessions are retained per customer; further sign-ins evict the oldest. Logout revokes only the current bakery/session, clears its cookie and is idempotent for an already revoked/expired cookie. It does not sign out staff or other bakeries. Active bakery status is required for account access. Existing valid sessions can read their own orders and confirm saved submissions after a menu is unpublished or ordering is paused; existing customers can also sign in again when a menu is hidden. New registration remains restricted to an accepting published menu.

These cookies deliberately support only the guarded local development environment. Production cookie/TLS policy, password-cost calibration, verified identity/recovery, durable rate limiting and session operations still require staging work. The SaaS APIs cannot be enabled on Vercel/production or a cloud database by setting the feature flag.

## Browser intent and account binding

Customer mutations require JSON, `X-Saas-Customer: 1`, and an allowed Origin when Origin is present (configured client origin or the API’s own origin). This blocks form-style/login CSRF. Authentication endpoints are limited to 10 attempts/minute per IP across bakery slugs in the current process.

Protected order/history/logout requests also supply `X-Saas-Customer-Id`, obtained from `/me` or sign-in. This is compared with the authenticated cookie identity; it is never used as an authority for lookup. If another tab signs in as a different customer, the old tab receives `CUSTOMER_SESSION_CHANGED` and clears its stale profile/history while retaining pending recovery. A stale tab cannot silently place an order for, read the history of, or log out the newly selected customer.

`/me` discovers the current scoped cookie identity. Copying a cookie token to another bakery name/path still fails because session queries include bakeryId. Legacy bearer tokens are not attached by the client to customer API requests, and the server ignores them for customer authentication.

## Pickup checkout

A signed-in customer chooses menu items, whole quantities and optional pickup instructions. A server quote rechecks the same bakery’s available/unarchived products, authoritative prices and stock. Changed prices or unavailable stock must be refreshed before review. Quotes do not reserve inventory.

Explicit confirmation records an unpaid pickup order and reserves finished-product stock. Customers cannot submit totals, discounts, event IDs, customer IDs, roles or paid status. The server assigns `source=storefront`, `fulfillment=pickup`, eventId=null, discount zero and received money zero. There is no online charge. The Counter & events screen identifies these as customer pickup orders; authorized staff can record actual payment received through the existing confirmation flow.

Customer and staff orders share `record-order.js`, so stock consumption, immutable cost snapshots, per-bakery numbering, stock movements and audit metadata commit through the same implementation. Customer writes use a separate fresh customer/session transaction guard; they never impersonate bakery membership. Audit/stock records distinguish customer actors from staff. Customer IDs and private costing/retry fields are excluded from operational order views.

There can be at most three open unpaid orders per customer/bakery; cancelled/expired reservations are excluded. This count is checked atomically after retry lookup and before reservation. Recording actual payment or closing a reservation releases a slot. Checkout quote/create/cancel/reservation refresh are limited to 30 requests/minute per customer/bakery in the current process, and normal bakery order capacity also applies. The development customer-account ceiling is 5,000 per bakery, including inactive accounts; the owner usage snapshot reports it.

## Owned histories and privacy

History and detail queries include both the resolved bakery and authenticated customer ID. Caller-supplied customer filters are rejected. Another customer in the same bakery, an account using the same email elsewhere and a global staff/admin token cannot read the orders. Returned items contain only product reference, name, selected quantities and sale prices. Recipe costs, operational stock flags, actor IDs, customer IDs, retry hashes/keys, events and mutable internal comments are omitted.

Order history reflects staff-recorded receipts, invoice corrections and refundable balances. An already-paid retry confirms payment recorded rather than asking for payment again. Menu paging/refresh preserves the current account/cart when the slug stays the same; changing bakery resets identity, credentials and in-memory cart. Delayed responses cannot replace the new bakery/account view.

## Recovery

Before sending, the client saves the exact confirmed cart, reviewed prices and UUID v4 key to tab-local sessionStorage, keyed by bakery slug and customer ID. It stores no session token or password. An unresolved submission cannot be overwritten. Reload/sign-in restores a pending banner; retry uses the exact original key even after prices change, ordering pauses or staff receive payment.

The backend binds the key to the customer identity and normalized payload. Identical replay returns the existing order before current availability/capacity checks. Another customer or changed payload receives a key conflict without disclosure of the original order ID. Cleanup requires a confirmed save or `SALE_REJECTED`, which is returned only after a transaction proves no saved order exists for that key. Storage corruption, access loss, account changes, conflicts and uncertain responses do not authorize discarding the saved request.

## API

All paths start with `/api/saas/storefront/:slug/customer` and remain behind the local-only SaaS guard:

| Method | Path | Behavior |
|---|---|---|
| POST | `/register` | Published, ordering-enabled bakery; email/password/displayName; establishes scoped session |
| POST | `/login` | Published bakery; email/password; establishes scoped session |
| GET | `/me` | Current customer profile from this bakery’s cookie |
| POST | `/logout` | Intent and expected customer header; revokes current cookie/session |
| POST | `/orders/quote` | Authenticated/identity-bound read-only cart review |
| POST | `/orders` | Confirmed pickup cart and UUID key; reserves stock once |
| GET | `/orders` | Own orders; limit 1–100 and ObjectId cursor |
| POST | `/reservations/refresh` | Bounded same-bakery expiry policy; no other customer IDs disclosed |
| POST | `/orders/:orderId/cancel` | Own unpaid, unconfirmed pickup reservation; version/confirmation/reason required |
| GET | `/orders/:orderId` | Own order details, without private operational fields |

Order input is items `{productId, quantity, expectedUnitPricePaise}` and optional comment; recording additionally requires confirmed:true, idempotencyKey and the quoted expectedReservationMinutes for a new order. No delivery, scheduling, coupons, gateway payment or customer assertion of received money is accepted.

## Remaining work

Unpaid cancellation and request-driven expiry with conservative stock returns are documented in `reservations.md`. A continuously scheduled expiry worker is not implemented. Paid orders cannot be cancelled through this flow. Pickup readiness/collection is now available (`pickup.md`). Delivery/tax rules, real email delivery/verified contact, account retention/export, real gateway routing and platform subscriptions remain later work. Opening hours are still display text; the owner’s acceptance switch controls checkout availability.

Browser visual QA and staging validation are pending. All validation used disposable loopback databases and synthetic credentials. No production customer data, legacy account migration, external email/SMS, real payment or deployment was performed.
