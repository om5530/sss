# Material inventory and recorded wastage

Owners now have an Inventory workspace for material balances, receipts, physical-count corrections, raw-material wastage and finished-product wastage. All records remain behind the development-only SaaS guard. No production data, backfill or deployment is involved.

## Material balances

Tracking is explicitly enabled per physical ingredient or packaging material by recording a counted opening balance, including zero. Opening is a baseline, not a receipt: its earlier quantity is unknown/null. Existing materials and earlier production remain untracked until enabled; earlier runs are never deducted again.

Balances use a stable base unit: g, ml, piece, packet or box. mg/kg convert to g, L to ml and dozen to piece. Decimal strings preserve exact quantities. Dimensions are not mixed and no density or packet-to-piece conversion is assumed. Labour, oven time and other resources remain untracked.

| Entry | Balance effect | Required review |
|---|---|---|
| Opening | Establishes a counted balance once | Material version, stock version 0, quantity, unit and reason |
| Receipt | Adds material already received | Current material/stock versions and receipt reference/reason |
| Waste | Deducts material already discarded | Current versions, quantity and reason; cannot overdraw |
| Count correction | Sets the balance to the measured physical quantity, including zero | Current versions and an explanation; does not invent a receipt or waste |
| Production | Deducts tracked recipe quantities when the run is saved | Server production quote and reviewed inventory fingerprint |

Tracking has no disable/reset endpoint. Corrections append a new count entry; earlier history remains intact. An enabled material may change pricing, pack size and compatible units, but cannot change to a different unit dimension or a nonphysical type. Existing inactive stock can still be counted or written off; receiving new stock requires an active material.

Manual entries snapshot a price-based estimate and material version. For receipts/waste this values the entered quantity; for opening/count it values the counted quantity. These are catalogue-price estimates, not supplier invoices, purchase payments, weighted-average/FIFO values or adjustment expenses.

## Production consumption

The production quote aggregates repeated material lines after unit conversion, shows required/before/after quantities for tracked materials, and rejects insufficient stock. The ingredient-cost source remains the mapped immutable recipe revision. A material’s inventory balance and its price estimate are distinct: production history retains the revision’s saved cost, while a later manual material entry uses the reviewed current material price.

The quote fingerprints the tracked material IDs, units, versions and usage. Saving requires the same fingerprint. A receipt, count, wastage entry, another production run or newly enabled tracking invalidates a stale production review even if the finished product did not change. Product stock addition, material deductions, production snapshots, both stock ledgers and audit metadata commit together. No partial batch or partial material deduction survives failure.

Untracked recipe materials are not deducted. The review lists tracked deductions alongside the full ingredient quantities. Old completed runs retain their old behavior; identical old submission retries return the existing run without retroactive consumption. Old pending requests can still replay if saved; an unsaved request must be reviewed again when tracking has since been enabled.

## Finished-product wastage

Owners can record whole wasted pieces against tracked product stock, optionally linked to one of the same bakery’s events. Archived products with remaining stock can be written off, and closed events can accept late wastage entries. A read-only quote shows the product, quantity, event, stock transition and saved recipe-cost estimate. Confirmation means the pieces were already discarded and are still included in the stock count.

Recording appends an immutable waste entry and stock movement, reduces product stock and advances its version atomically. It never changes past sales. Simultaneous entries cannot consume the same remaining pieces twice. The cost snapshot retains mapped revision ID, original batch cost, yield and quantity; later material prices or mappings never reprice it. An unmapped product can still be written off, but its cost is explicitly unknown.

A linked event’s report subtracts the known saved cost of its recorded finished-product wastage. Waste quantities sharing a saved revision/cost/yield are grouped before division, so wasting all nine pieces separately preserves the whole-batch cost exactly. Missing sold-item or wastage costs make recorded profit null. The report shows entered wasted units, known wastage cost and one recorded-profit figure.

This is not final net profit: unrecorded losses, raw-material wastage without event allocation, prepared/reusable stock, inventory-lot valuation and other unentered expenses remain excluded. `includesProductionWaste` stays false because comprehensive production-waste accounting is not implemented. Production costs and raw material consumption are not added to event expenses a second time.

## Safe retries and permissions

Every manual material or finished-waste save requires explicit confirmation, a reason and a UUID v4 key. Keys are bakery-scoped and bound to normalized input and actor. Replays resolve before current stock/price/version/capacity checks; changing payload or actor conflicts. The server rechecks membership and active bakery inside the write transaction.

The UI saves the exact request to actor/bakery-scoped sessionStorage before sending. Reloads restore a pending banner. It will not overwrite an unresolved request, silently discard corruption or send after a failed recovery write. Cleanup requires a confirmed save or an explicit `INVENTORY_REJECTED` / `WASTE_REJECTED` issued after proving no record exists for that key. Access loss, key conflicts and uncertain responses retain recovery. Retry confirms an existing physical action; it must not trigger receiving/discarding the stock again.

Owners alone can view balances, movement histories, waste histories and costs. Queries and all referenced materials/products/events are bakery-scoped; global legacy admins receive no bypass. Responses omit actor IDs, hashes and retry keys. Costs start hidden behind eye controls and hide on refresh, mutation, bakery change and page visibility loss. Late requests cannot restore another bakery’s view.

## API

All paths start with `/api/saas/bakeries/:bakeryId`:

| Method | Path | Behavior |
|---|---|---|
| GET | `/inventory` | Owner; paginated tracked material balances |
| POST | `/inventory/quote` | Read-only opening/receipt/waste/count review |
| POST | `/inventory` | Confirmed material movement with idempotency key |
| GET | `/inventory/:materialId/history` | Owner; bounded immutable material history |
| POST | `/waste/quote` | Read-only finished-product wastage review |
| POST | `/waste` | Confirmed finished-product waste with idempotency key |
| GET | `/waste` | Owner; bounded history, optional eventId filter |

Manual material fields: materialId, kind, decimal-string quantity, uom, expectedMaterialVersion, expectedStockVersion and reason. Saving additionally requires confirmed and idempotencyKey. Finished-waste fields: productId, eventId or null, whole quantity, expectedProductVersion and reason, plus confirmation/key when saving. Client-supplied costs, balances, owner IDs and bakery IDs are rejected.

Development ceilings count 50,000 material movements (including production deductions) and 10,000 finished-waste entries per bakery. Capacity rejection rolls back a production run if any required material movement would exceed the ceiling; identical retries remain available. The owner usage view reports both counts. These are development ceilings, not subscription plans.

## Remaining work

Inventory lots and actual purchase valuation, supplier invoices/receipts, density conversions, event stock allocations, stock returns, waste reversal/cost corrections and reconciliation need later workflows. Current count corrections preserve raw-material audit history; finished-waste records have no edit/delete endpoint. Browser visual QA and staging validation remain pending. The legacy app’s production data and unscoped collections remain untouched.
