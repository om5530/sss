# Local pickup reservations

This milestone applies only to the guarded local SaaS development workspace. It changes no legacy or production records and introduces no payment gateway, background daemon or production scheduler.

## Customer and owner flow

Menu settings let an owner choose an unpaid pickup hold of 5–1,440 whole minutes (default 30). Checkout quotes show that duration. Confirmation binds the reviewed duration to the request; a changed setting requires another review. Each saved order keeps its original expiry. Quotes do not reserve stock.

Customers can cancel their own unpaid, unconfirmed pickup reservations from their order history, after reviewing the order and entering a reason. Owners have the same capability in Counter & events. Neither path can cancel counter sales, paid/partially paid orders, or orders previously confirmed through a receipt or a fully discounted invoice. The confirmed marker persists even if a later correction makes the invoice unpaid again.

Closed orders retain their invoice, item and cost history, with a separate `cancelled` or `expired` reservation state. They show zero due/refund balance and cannot receive further receipt, discount or refund mutations. They no longer consume the customer's three-unpaid-order allowance. This is cancellation of an unpaid hold; no money moves and no return of collected goods is inferred.

## Request-driven expiry

Authenticated customer history refresh and checkout review first POST a same-bakery expiry refresh. Owners can explicitly choose **Release expired pickups**. Each transaction closes at most 20 due, active, unpaid, never-confirmed reservations with zero received money. Additional batches require another refresh/action. Customer responses reveal only `availabilityChanged` and `hasMore`, never other customers' orders or stock exceptions. The menu refreshes after a reservation change.

There is no automatic timer while nobody uses the app. GET requests do not mutate orders, orders are not deleted by TTL, and no production cron was added. Payment/correction mutations reject an overdue unconfirmed hold even before cleanup occurs. A replay of an already-saved checkout still returns its current closed state rather than creating or reviving an order.

Earlier development orders without an expiry are not backfilled or swept. They can be manually cancelled under the same unpaid/unconfirmed rules. A saved pre-duration checkout retry remains hash-compatible; a new unsaved old-format submission is definitively rejected so its terms can be reviewed.

## Conservative stock returns

Every new claimed stock line snapshots the product's count epoch. Cancellation returns only originally claimed tracked quantities when that epoch still matches. Normal sales, completed production, waste and other reservation returns change stock/version without replacing the epoch.

Changing a count or enabling/disabling tracking replaces the epoch. The product editor also has **Confirm a fresh count of available stock**, which replaces the epoch even if the number is unchanged. Saving a name/price change while resubmitting the unchanged stock number does not invalidate existing reservations. The API owns the epoch; callers cannot supply it.

A changed count, missing product, disabled tracking, missing old epoch or stock overflow records an exception instead of inflating inventory. Untracked original lines require no return. Owners see the saved per-line return outcomes and a recount notice; customers receive only closure status. A fresh recount in Products journals the corrected available count. Historical exception notices remain as evidence; a separate reconciliation acknowledgement workflow is not implemented.

Stock changes, `reservation_return` movements, closure/version and audit metadata commit together under the bakery transaction lock. Repeating cancellation, including after an uncertain response, returns the terminal record without restoring twice or rewriting its reason. Competing cancellation/payment/expiry requests serialize. Required version, confirmation and reason protect the initial manual close; idempotent retries accept an already-closed record.

## API

| Caller | Method and path | Input |
|---|---|---|
| Customer | `POST /api/saas/storefront/:slug/customer/reservations/refresh` | Empty object; cookie, intent and expected customer headers |
| Customer | `POST /api/saas/storefront/:slug/customer/orders/:orderId/cancel` | `expectedVersion`, `confirmed:true`, reason |
| Owner | `POST /api/saas/bakeries/:bakeryId/orders/expire-reservations` | `confirmed:true` |
| Owner | `POST /api/saas/bakeries/:bakeryId/orders/:orderId/cancel-pickup` | `expectedVersion`, `confirmed:true`, reason |

Customer quote/create/cancel/refresh share the 30-per-minute in-process per-customer/bakery limiter. Every mutation rechecks active bakery, membership or customer/session within its transaction. Customer cancellation queries include both bakery and customer; owner-only reconciliation details are omitted from staff order views. Audit metadata now preserves the supplied customer/staff actor type.

## Remaining boundaries

Physical collection milestones are now available (`pickup.md`). Paid-order cancellation, physical returns, verified identity/password recovery, shared rate limiting, scheduled expiry, staging validation and commercial billing remain later work. Browser visual QA has not been performed in this runner.
