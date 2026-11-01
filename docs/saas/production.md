# Completed production runs

Owners can record completed whole batches for a product with tracked stock and a mapped recipe revision. This adds finished pieces to the product count and records an immutable production/cost snapshot. When tracking has been explicitly enabled, it deducts reviewed material quantities atomically (`inventory-wastage.md`). It does not prove a supplier/material receipt.

## Review and recording

The owner selects a product, completed batch count (1–1,000) and optional note. A read-only server quote loads the verified bakery’s active product, active recipe family and currently mapped immutable revision. Both the reviewed product version and revision ID must still match. Untracked or archived products cannot be recorded.

The quote shows product/recipe names, revision, pieces per batch, produced pieces, before/after stock and ingredient quantities for all batches. Costs use the saved revision’s ingredient prices and overhead, multiplied using Decimal arithmetic. Changing material prices later does not silently reprice this revision or earlier production entries. To use a newly costed recipe, create/map the appropriate revision before reviewing production.

Confirming means these batches are **already completed** and their pieces have not yet been included in the current stock count. Recording adds the quoted pieces. A saved run is not a command to bake more pieces. Total produced pieces and resulting tracked stock must each stay within 1,000,000.

Example: a mapped nine-piece revision, two completed batches and stock of one produces 18 pieces and records stock of 19. Run, product version/count, stock movement and audit metadata commit together. A failed persistence/audit operation restores all of them. Competing different entries reviewed against the same product version cannot both apply; the second must refresh.

## Retry safety

Recording requires explicit `confirmed:true` and a UUID v4 key. The key is unique per bakery and bound to the normalized product/revision IDs, reviewed version, batches, note and authenticated actor. An identical retry returns the saved run before checking current catalogue state or capacity. Changed details or another owner reusing that key return `PRODUCTION_KEY_CONFLICT`.

The workspace stores the exact request, product label and produced-piece count in actor/bakery-scoped sessionStorage before sending. A failed storage write sends no request. Reloads restore a pending-entry banner. A different entry cannot overwrite it, and retry uses the same original key/details. A confirmed save or `PRODUCTION_REJECTED` permits cleanup. That rejection code is issued only after a transaction has proven no run exists for the key. Access failures, key conflicts and uncertain responses retain recovery. Corrupt records fail closed. This is tab-local recovery, not cross-device synchronization.

## Permissions and display

Only active owners can quote, record or page through production. Every product, family, revision, run and stock-movement reference is bakery-scoped. Staff and global legacy admins do not gain production-cost access through a global role. Actor IDs, request hashes and submission keys are excluded from controller responses.

The workspace’s owner-only Production tab includes quote review/confirmation, pending recovery and cursor-paged run history. Recipe cost estimates start hidden behind an eye control and hide on bakery changes, refresh, recording and visibility loss. Ingredient quantities can be reviewed without revealing prices. Late quote/save/list responses cannot replace data in another bakery.

All paths start with `/api/saas/bakeries/:bakeryId`:

| Method | Path | Purpose |
|---|---|---|
| POST | `/production/quote` | Read-only review; productId, revisionId, expectedProductVersion, batches and optional note |
| POST | `/production` | Confirmed completed run; the same reviewed fields plus confirmed and idempotencyKey |
| GET | `/production` | Owner history; limit 1–100 and ObjectId cursor |

There is a development ceiling of 5,000 immutable runs per bakery. The owner usage view reports this count. Identical retries remain available at capacity. Owner IDs, bakery IDs and client-supplied costs or resulting stock are rejected as unexpected write fields.

## Accounting boundaries

Production snapshots are recipe cost estimates, not inventory-lot valuations. Run history retains stock at recording; that value is not current stock after later sales or adjustments. The stock ledger links each production addition to its run. Runs have no edit/delete endpoint; owner count adjustments remain separately recorded.

Production costs are not added again to event expenses or recorded profit. Sales retain their existing saved recipe-cost snapshots. Material on-hand consumption and entered wastage are now implemented in `inventory-wastage.md`. Lot balances, FIFO/other cost allocation, variable actual yields, production reversal, stock returns and event stock allocations require later workflows. This feature does not set `includesProductionWaste` to true or claim final net profit.

The local-only SaaS guard remains in place. Tests use synthetic disposable loopback databases. No production data, migration, backfill, real payment or deployment is involved.
