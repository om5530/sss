# Tenant product stock history

The development catalogue now records quantity changes in immutable, bakery-scoped `saas_stock_movements` documents. This is finished-product count history, not raw-material inventory or production costing.

| Kind | Meaning |
|---|---|
| `opening` | A product was created with a tracked opening count. The earlier count and delta are unknown/null. |
| `adjustment` | An owner changed a numeric tracked count. Before, after and signed delta are retained. |
| `tracking` | An owner enabled or disabled tracking. Null denotes untracked; the delta is null rather than inventing a quantity. |
| `waste` | Entered finished-product wastage reduced tracked stock and links to its immutable waste entry. |
| `production` | Completed recipe batches added finished pieces, linked to that tenant’s immutable production run. |
| `reservation_return` | Unpaid pickup cancellation/expiry restored a previously claimed quantity whose stock count remained reliable. |
| `sale` | A tracked product count was consumed by a saved paid/unpaid sale, linked to that tenant's order. |

Movements retain product version and timestamp. Price/name/recipe mapping edits do not invent stock movements. Untracked sales do not claim stock or create a quantity movement. Re-entering the same count without explicit recount confirmation creates no movement even though the product edit may advance its version. Explicitly confirming a fresh count journals an adjustment even if its delta is zero, and invalidates automatic returns of earlier reservations.

## Atomicity and isolation

Movement writes share the catalogue/sale transaction with stock, order numbering and audit metadata. A failed audit or persistence operation rolls back the count and movement together. Identical sale retries return the existing order before making stock changes. The unique bakery/product/version index prevents duplicate movements for one stock-changing version; gaps in stock history versions are expected when non-stock fields change.

`GET /api/saas/bakeries/:bakeryId/products/:productId/stock-history` is owner-only and no-store. It accepts bounded `limit` (1–100, default 30) and ObjectId cursor pagination. Both the product existence check and history query use the verified bakery. Foreign product IDs return 404. Actor identifiers and raw bakery/product keys are excluded from response rows; order IDs refer only to the same tenant's saved sales. Costs and payment details are absent.

The Products screen exposes **Stock history** under the selected product, with paging, refresh and close. It clears loaded rows on selection changes or access failure, and ignores delayed responses after a bakery/product change or component destruction. Staff have no stock-history control and cannot access the endpoint.

## Boundaries

Completed-run recording is available separately (`production.md`). It adds product stock and snapshots recipe costs, but does not establish lot balances. Optional raw-material balances and production deductions are now available in `inventory-wastage.md`.

Existing earlier development records are not backfilled and earlier activity is not reconstructed. The next stock mutation records its observed before/after count. A manual stock increase is an adjustment, not proof of a production run or material consumption.

Lot allocation/valuation, paid-product returns, event allocations and inventory valuation remain separate future work. Historical sales continue using their saved recipe-cost snapshots; this ledger does not recost them or change event profit rules. Those features need explicit links and cost allocation rules before being enabled.

All models/routes remain behind the local-only SaaS guard. No production database, migration, backfill or deployment was used.

Unpaid pickup cancellation/expiry also journals `reservation_return` movements. Changed counts replace a stock epoch; only matching reserved quantities return automatically. See `reservations.md` for recount exceptions and request-driven cleanup.
