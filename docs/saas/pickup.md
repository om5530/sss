# Local pickup readiness and collection

Customer pickup orders now have preparation/collection milestones separate from payment and reservation state. New storefront orders start as `pending`; older development pickups without a milestone display as pending until explicitly updated. Counter/event sales do not get pickup milestones. No records were backfilled.

| Current state | Staff action | Requirements and result |
|---|---|---|
| Awaiting preparation | Mark ready | Active same-bakery owner/staff, reviewed version and confirmation; records ready timestamp |
| Ready for pickup | Confirm already collected | Full payment must already be recorded and remaining due must be zero; records collection timestamp |
| Collected | Retry earlier confirmation | Returns the current milestone without another mutation or timestamp change |

Marking ready does not receive money, extend an unpaid hold or consume more stock. An unpaid ready order may still be cancelled or expired under the reservation policy. Closed and overdue unconfirmed reservations cannot progress. Collection does not take payment or imply a refund: staff first record actual payment through the separate receipt flow, then confirm the items were handed over.

Milestones move forward only. Collected goods are never automatically returned by reservation cancellation/expiry. The persistent confirmation marker also protects collection after later invoice corrections. A later owner correction may still create money due or refundable, but does not reverse a physical handover. Physical returns/reversal need a separate future workflow.

## API and isolation

`POST /api/saas/bakeries/:bakeryId/orders/:orderId/pickup-status` accepts exactly `status` (`ready` or `collected`), `expectedVersion` and `confirmed:true`. It uses fresh member authorization and the same bakery transaction lock as payment, cancellation and expiry. Foreign orders are not found; customer cookies never grant staff access. Timestamps, received money and arbitrary states cannot be supplied by callers.

The initial update requires the reviewed order version. Duplicate updates to a reached milestone return `alreadyUpdated:true`; a late ready retry after collection returns the collected record rather than regressing it. Cancelled/expired records reject progression, including stale retries. Audit, version and milestone timestamps commit together. A failed audit rolls all milestone changes back. No additional stock movements or payment entries are created by a pickup update.

Staff order lists/details and the owning customer's history expose pickup state and timestamps. Customer views continue omitting private costs, staff/customer identifiers and retry metadata. The Counter & events screen reviews the order and action before either update, retains the same reviewed version after uncertain responses and ignores delayed responses after switching bakeries. Customer pages require a refresh to see staff updates; no notifications or live push were added.

## Boundaries

There is no automatic ready detection, collection identity verification, partial collection, delivery scheduling, handover reversal, messaging, deadline extension or scheduled expiry worker. This remains behind the local-only SaaS guard, with no production migration or deployment. Browser visual QA remains pending.
