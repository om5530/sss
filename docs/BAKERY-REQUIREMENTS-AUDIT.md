# Bakery operations implementation audit

Updated 2026-09-10 against the supplied 45-section prompt. Replaces the earlier prototype audit. All changes are local; nothing has been pushed or deployed.

## Architecture and boundaries

Angular standalone components, Express, Mongoose and MongoDB remain the application stack. Bakery operations reuse admin authentication, routing and the existing cream/brown design system. Every bakery API requires the admin role and returns `Cache-Control: no-store`.

Customer, ordering, payment and invoice documents are untouched. This repository has Product/Order models, rather than the legacy Items/Invoice accounting source described in the prompt. Selling prices are never imported as ingredient purchase costs. No new customer CRM has been introduced.

The original prototype used floating-point calculations, mutable cached costs, client-supplied quote totals and direct stock edits. The replacement uses a shared Decimal engine, supplier formats and effective price history, recipe revisions, server-generated snapshots and transactional operations.

## Requirements coverage

| Prompt | Implemented |
| --- | --- |
| 1–4: architecture and philosophy | Separate internal bakery workspace; existing stack retained; calculator and prefilled production exceptions replace manual costing. |
| 5: materials | Ingredient, packaging, labour and resource types; code, category, base UOM, pack, stock/minimum/reorder, supplier/brand, density, description, notes and optional image URL. |
| 6–8: purchase formats/history | Supplier, Format and append-only Price records; multiple suppliers/packs, MOQ, lead time, preferred format and effective dates. Latest effective preferred price drives live projections. Receiving adds price history. |
| 9: UOM | Decimal mg/g/kg, ml/L, pieces/dozens, minutes/hours. Boxes/packets remain distinct. Unknown units and invalid dimensions are rejected. Mass/volume requires explicit material density. |
| 10–12: recipes/nesting | Versioned recipes, recursive sub-recipes, dependency validation including custom options, component breakdown, live preview, archive safeguards and revision history. Cycles are rejected. |
| 13–15: labour/equipment/packaging | Workers × time × rate, linear/fixed scaling, capacity-based equipment cycles and time conversion; packaging included in cost and stock requirements. |
| 16–20: calculator/configurator/pricing | Single/multi-recipe quantity or finished-weight scaling; named custom option components; six-category cost breakdown; markup or target margin; reference/person/date/notes; saved costing sheets and plans. Server computes saved totals. |
| 21: inventory | Opening, receipt, consumption, waste, adjustment and return ledger. Current/allocated/available stock; pack-to-base conversion; stale stock-count protection. Completed batches record production output. |
| 22–24: purchasing | Aggregated shortages, whole packs, MOQ, supplier alternatives, spend/excess/lead time. Draft → ordered → partial → received; cancellation before full receipt. Stock enters only on receipt, never PO creation. Receipt retries are idempotent. |
| 25–27: waste/yield | Material and packaging waste deduct stock with server cost; finished-product waste uses batch cost and remaining-output validation; production scrap/process loss, quantities/money/reason/date, expected/actual yield reports. |
| 28–30: production/preparation | Plans allocate stock; completion consumes actual quantities atomically; planned/actual variance and output. Repeated recipes retain separate output line IDs. Plan-specific printable preparation list. |
| 31–32: history | Immutable recipe revisions and costing/production snapshots. Current-cost comparison is separate. Migration preserves original totals/documents. |
| 33–35: dashboard/reports | Upcoming production, reorder indicators, waste, recipe cost changes/current margin, usage/variance, yield/loss, stock movements, price history, goods receipts and recorded output. Inclusive India-calendar report dates. |
| 36: optional traceability | Receipt lot and expiry capture. Full lot allocation/FIFO/FEFO and ingredient-lot-to-product traceability remain optional work. |
| 37–38: precision/engine | decimal.js with 40 significant digits. Authoritative money/quantities stored and returned as decimal strings; display rounding only. Material and recipe previews call the backend. |
| 39–40: migration | Reviewed pack-name parser/import and repeatable non-destructive database migration. No automatic invoice conversion because the described legacy accounting source is absent. |
| 41: acceptance tests | Exact rates, cake total, markup/margin, stepped capacity, nesting, mixed UOM and weight tests; API tests for authorization, snapshots, receipts, stock, production, waste and migration. |
| 42: UX | Consistent typography/cards/controls/spacing/navigation; compact phone menu and contained horizontal tables. Calculator updates in place; production starts with planned quantities. |
| 43–45: phases/rules | Core phases 1–7 implemented in the engine, models, API and UI. Rollout and optional limits remain explicitly listed below. |

## Database/domain model

`BakeryMaterial` stores base UOM, stock and preferred format. `BakeryOperations.js` defines Supplier, Format, Price, Revision, Sheet, Movement, Purchase, Receipt and Migration models. Existing Recipe and Waste models are extended. A Sheet stores the server snapshot, plan lifecycle, actual consumption/output and completion key. Movements preserve each material balance change. Migration markers prevent duplicate imports.

Mongo transactions and a bakery write guard serialize stock/recipe mutations across stateless API instances. Receipt/production state and stock movements commit together or roll back together. MongoDB requires a replica set or Atlas transaction support.

## Navigation

Overview → Materials → Recipes → Calculator → Production → Inventory → Purchasing → Waste → Reports. Import materials is an additional admin entry.

## Exact formulas

- Base rate = pack purchase price ÷ pack quantity converted to base UOM.
- Units from finished weight = requested grams ÷ finished batch grams × batch yield.
- Linear quantity = base quantity × requested units ÷ recipe yield.
- Fixed batch quantity = base quantity × ceiling(requested units ÷ yield).
- Equipment cycles = ceiling(requested units ÷ capacity); cost = cycles × cycle duration converted to resource base time × rate.
- Labour = workers × converted duration × rate.
- Batch cost = ingredients + packaging + labour + resources + other direct costs + overhead, including recursive sub-recipes.
- Unit cost = batch cost ÷ units. Gram cost = batch cost ÷ finished grams when known.
- Markup price = cost × (1 + markup/100). Profit = price − cost. Margin = profit/price × 100.
- Target-margin price = cost ÷ (1 − margin/100); target margin must be below 100%.
- Available = max(0, stock − allocation). Shortage = max(0, required − available).
- Packs = max(ceiling(shortage ÷ base pack quantity), MOQ), or zero for no shortage. Excess = purchased quantity − shortage; spend = packs × pack price.
- Actual cost = snapshot cost + sum((actual consumption − planned consumption) × snapshot rate).
- Shared actual costs are allocated proportionally to planned product costs, not individually metered labour/equipment.
- Actual process loss % = (input grams − baked grams)/input grams × 100. Expected weight = input grams × (1 − expected loss/100).

## Migration and rollout

From `server`, `npm run bakery:migrate` is read-only. `npm run bakery:migrate -- --apply` adds missing formats, prices, opening movements and revisions; copies old saved sheets as preserved historical drafts. It does not automatically schedule historical sheets with incomplete assumptions. Repeat execution does not duplicate records.

The configured database preview found **15 materials, 1 recipe and 0 legacy sheets**. Apply has **not** been run against that database. Back up the target and apply the migration with the code rollout. The old schema's default density of 1 is cleared because it was not evidence of a measured ingredient density; review genuine measured values during rollout.

## Verification

- Full backend suite: 63 passing tests, including concurrent stock consumption, date boundaries and minimum-stock alerts.
- All ten bakery routes at 390, 820 and 1366 px: no document overflow or runtime errors.
- Browser workflow: target-margin calculation for 24 units → save plan → complete production; phone menu and material editor.
- Browser mutations run against an isolated Mongo replica set and ephemeral API, never business stock.
- Migration tests: dry run writes nothing; apply twice creates one historical copy with original total.
- Angular production build passes with the existing unrelated `qrcode` CommonJS optimization warning.

## Explicit limits

- Migration application and deployment are pending; no real business stock was changed for testing.
- Optional full lot traceability and invoice-to-draft migration are not implemented. Receipt lot/expiry and reviewed material imports are implemented.
- Recorded output is separate from storefront fulfillment; output less waste is not a warehouse balance after dispatches.
- Cost-change indicators compare live cost with saved recipe baseline. They are dashboard/report indicators, not outbound notifications.
- Responsive Edge viewport checks are not physical iPad/Safari certification or a large-data load test.
