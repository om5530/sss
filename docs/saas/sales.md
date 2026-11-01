# Tenant event sales foundation

This milestone includes backend APIs, typed Angular contracts and the development workspace Counter & events screen. All endpoints remain behind the local-only SaaS guard. No production data was read or changed.

## Authorization and storage

Shared `saas_events`, `saas_orders`, `saas_payment_entries` and `saas_order_changes` collections hold bakery-keyed records. Every query and referenced product, recipe revision or event is restricted to the verified bakery. Owners/staff may record and view sales. Event creation/closure, expenses and financial reports are owner-only; staff event lists omit expenses. Global legacy admins receive no membership bypass.

Writes recheck active membership and bakery status inside the transaction. Order writes, stock consumption, per-bakery numbering and audit metadata commit together. Failed persistence restores stock and numbering. This development foundation serializes writes through the bakery authorization record; load testing and more granular concurrency are needed before production scale.

## Orders and manual payments

A sale accepts product IDs, whole-number quantities and reviewed unit prices. The server loads authoritative prices and rejects changed quotes. Client totals, line prices and costs are not accepted. Integer-paise discounts cannot exceed the subtotal; zero-total complimentary orders are allowed.

Orders retain original names, prices, quantities and private cost snapshots from the selected recipe revision. Later material prices or recipe mappings never recost sales. Unmapped products have unknown costs; reports return null recorded profit if a paid line lacks a saved cost.

Cash, UPI and card are manual bookkeeping methods. Recording received payment does not contact a bank, gateway or customer and transfers no money. Unpaid settlement requires explicit confirmation, the reviewed order version and received method. Settlement records only the remaining due, including when an earlier receipt covered part of a corrected invoice. Concurrent or stale confirmations cannot record it twice. Payment methods on orders describe the last receipt; the ledger retains the method for each receipt/refund. Cancellations, quantity edits, stock returns, gateway refunds, taxes and delivery remain future work; these APIs do not reuse unscoped legacy flows for them.

The report exposes **recorded profit**: fully paid invoice values minus their saved sold-item costs, entered expenses and linked recorded finished-product wastage estimates. This differs from cash received when an invoice is corrected or partially paid. Reports separately expose net recorded receipts after manual refunds, outstanding dues and refunds owed. It is not final net profit. Comprehensive production waste and prepared/reusable stock are not implemented here; `includesProductionWaste` is explicitly false. Unknown costs are never treated as zero.

Closing an event prevents new sales. Identical retries still return previously recorded orders, and outstanding dues may be settled. Reports use a consistent read snapshot and original saved costs. Closing does not freeze a financial statement.

## Discount corrections and refund bookkeeping

Owners can correct a discount with a nonempty reason, explicit confirmation and expected order version. The API preserves original items, stock consumption, selling prices and saved recipe costs. It retains previously received money instead of silently rewriting payment history. The immutable correction log records old/new discounts and totals, versions and the reason.

Example: a ₹100 paid order corrected to ₹70 still has ₹100 received and shows ₹30 owed back. A ₹60 paid invoice corrected to ₹90 shows ₹30 remaining due. Settlement then records only that ₹30. A zero-total complimentary order changed to a positive invoice becomes unpaid until receipt is explicitly confirmed.

Refund entry confirms money **already returned manually**. It does not initiate a transfer. Owners must review the exact full refundable balance, method, reason and order version. UUID v4 keys are bound to the reviewed request and actor; identical retries return the existing entry, and changed details conflict. Ledger, cached balance and audit metadata commit atomically. Partial refund recording and refunding beyond an overpayment are not implemented.

The UI saves the exact reviewed order ID/number and refund request/key to actor/bakery-scoped sessionStorage before sending. Reloads and dialog closure retain a pending-refund banner; review/retry confirms the same record, and a different refund cannot overwrite it. Storage failure sends no request. Corrupt recovery records fail closed. Cleanup requires a confirmed save or `REFUND_REJECTED`, which is returned only after a transaction proves no refund exists for that key. Access loss, key conflicts and uncertain responses retain recovery. This is tab-local recovery, not bank reconciliation or cross-device synchronization. A retry records money already returned; it must not trigger another physical payout. Order versions and balance checks also prevent a second ledger entry for the same unchanged balance.

Earlier development orders without an explicit received balance are supported on mutation by an explicitly labelled inferred baseline, using their old paid/unpaid state if no ledger exists. This is a compatibility rule for local development records, not imported bank evidence or a production backfill. Reads never modify records.

Owners can page through payment and correction histories; staff and other bakeries cannot access them. Reasons are text, and operation keys, request hashes and actor IDs remain private. History responses are no-store.

## Retry safety

New sales require a UUID v4 idempotency key, unique per bakery and bound to the normalized payload and authenticated actor. Identical retries return the original order without consuming stock or numbering. Changed payloads or another actor's submission return 409. Replay checks precede current event/catalogue checks, allowing confirmation after closure or a price change.

`saas-sale-recovery.ts` provides the counter screen’s tested recovery helper. It retains the exact request/key through a supplied storage adapter, namespaced by actor and bakery. It refuses to overwrite an uncertain submission, clear another key, accept malformed payloads or continue after a silently dropped write. Corrupt recovery records fail closed. The counter screen writes recovery state to the current tab’s sessionStorage before sending a sale. Reloading the workspace restores the exact submission. It removes that record only after a confirmed save or an explicit SALE_REJECTED response proving no order existed for that key inside the transaction. Authentication/access failures, network/server errors and key conflicts retain recovery state. A different bakery or signed-in actor cannot view or overwrite that pending request.

## Routes

All paths start with `/api/saas/bakeries/:bakeryId`:

| Method | Path | Behavior |
|---|---|---|
| GET | `/events` | Members; paginated staff-safe summaries |
| POST | `/events` | Owner; name, tenant-local key and rent/travel/extra expense amounts |
| POST | `/events/:eventId/close` | Owner; expectedVersion and confirmed:true |
| GET | `/events/:eventId/report` | Owner; counts, received/outstanding amounts, saved costs and recorded profit |
| GET | `/orders` | Members; cursor, eventId and paymentStatus filters |
| POST | `/orders` | Members; manual paid/unpaid sale and idempotency key |
| GET | `/orders/:orderId` | Members; own bakery only, without private costs/retry internals |
| POST | `/orders/:orderId/settle` | Members; expectedVersion, confirmed:true and paymentMethod; remaining due only |
| PATCH | `/orders/:orderId/discount` | Owner; reviewed discount, optional comment, reason, expectedVersion and confirmed:true |
| POST | `/orders/:orderId/refund` | Owner; manually returned overpayment, exact expectedRefundPaise, method, reason, expectedVersion, confirmed:true and UUID key |
| GET | `/orders/:orderId/history/payments` | Owner; bounded cursor pages of receipts, refunds and inferred baselines |
| GET | `/orders/:orderId/history/changes` | Owner; bounded cursor pages of discount corrections |

Private costs, actor identifiers, request hashes and retry keys are excluded from responses, including JSON serialization of an explicitly cost-loaded document. Numbers such as ORD-000001 are independent per bakery.

## Next integration

The counter screen includes sale review/confirmation, paid/unpaid entry, explicit received-payment confirmation, event creation/closure, cursor paging and a single owner eye control for finances. Figures start hidden and are cleared on event/bakery/visibility changes; late report responses cannot reveal them again. The screen also exposes owner-only discount editing, payment/correction histories and explicit confirmation of manually returned overpayments. Material inventory and entered finished-product wastage are now available in `inventory-wastage.md`. Next add stock returns and tenant-specific payment routing. Test with two synthetic bakeries before any rollout.

Batch-cost snapshots retain both the original batch cost and yield. Allocating a complete nine-piece batch multiplies quantity before division, preserving the exact whole-batch cost instead of multiplying a rounded repeating per-piece decimal.


## Customer pickup source

`customers.md` adds unpaid pickup checkout using the same transaction-level order writer. Staff/counter writes retain their membership guard and historical retry hashes; customer writes use a separate cookie/session/customer guard. Customer pickup rows are labelled in the counter. Owner/staff operational views omit customer IDs and email data. Public customers cannot set payment status, discounts or event attribution.
