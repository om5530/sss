# Bakery operations system audit

Reviewed against the bakery operations prompt on 2026-09-10. The current implementation is an admin-only Angular/Express/MongoDB prototype with a materials screen, recipe screen, single/multi-product calculator, inventory quantity editing, and a waste log. The existing CRM, ordering, payment, and invoice modules remain separate.

## What is working

- Admin-only bakery routes are mounted under `/api/admin/bakery` and the Angular admin navigation exposes Calculator, Recipes, Materials, Inventory, and Waste.
- Materials calculate a purchase-pack unit rate automatically for the supported mass, volume, count, and time units.
- Recipe costing separates ingredients, packaging, labour, and resources. Recipes can be scaled and the calculator can aggregate multiple recipes and show a basic shortage estimate.
- Markup and gross margin are distinct formulas in the cost service. The acceptance examples for flour, butter, cocoa, sugar, milk, oil, the butter-cake total, markup, and stepped oven capacity pass in `server/test/bakery-cost.test.js`.
- Existing invoices are not modified by these bakery routes. Archive operations use `isActive: false` rather than destructive deletion.
- The UI includes draft costing-sheet/production-plan persistence and a waste-cost preview.

## Gaps that block a full sign-off

### Critical correctness

- The authoritative engine uses JavaScript `Number` throughout. The prompt requires Decimal/NUMERIC as the money authority; Mongo schemas also store prices and costs as `Number`. This can introduce rounding drift and does not satisfy the precision rule.
- `convertUnits()` silently returns the original quantity for unknown or invalid cross-type conversions. The prompt requires mass/volume conversion to be rejected unless an ingredient-specific density/conversion exists. Invalid UOM pairs need a validation error.
- Nested recipe costing is only a one-level lookup. There is no recursive evaluation, circular-reference detection, or immutable recipe-version snapshot.
- `updateRecipe()` and `updateMaterial()` recalculate cached values from the request body and current records, but do not create versions or historical cost snapshots. A saved costing sheet stores totals supplied by the client and is not re-evaluated server-side.

### Phase 1 incomplete

- A material has one `supplierName`, one pack, and one current price. There is no supplier entity, multiple supplier formats, preferred-format flag, MOQ, supplier code, purchase history, effective date, or price-history model.
- There is no migration assistant for parsing existing Item names or reviewing invoice-to-draft-recipe imports.
- There is no non-destructive database migration file or migration runner for the new collections/schema.

### Production, inventory, purchasing, and waste incomplete

- `BakeryProduction` is used as a saved calculator record, but there are no production-batch endpoints, planned-vs-actual ingredient quantities, actual yield, variance, batch version, or inventory consumption transaction.
- Inventory is a current-stock field with direct overwrite/adjustment. There is no stock-movement ledger for receipts, production, output, waste, adjustments, or returns; no allocated stock; and no receiving workflow.
- Purchasing has no suppliers, purchase requirements endpoint, purchase orders, goods receiving, status transitions, or price flow from receiving into recipe projections.
- Waste supports a single material-oriented log. It lacks product/batch linkage, production scrap, finished-goods and packaging workflows, expected-vs-actual yield, and waste reports by ingredient/product/reason.
- There are no bakery dashboard metrics, cost-change impact alerts, ingredient price-history reports, usage/variance/yield reports, or profitability reports. Existing sales reports are customer-order reports, not the requested internal bakery reports.

### UX and domain gaps

- Calculator covers single and multi-product scaling, but does not yet provide a complete fast workflow for target margin, custom costing sheets with required date/notes, configurable cake options, or a printable preparation list grouped by recipe/batch.
- Resource scaling currently supports a stepped oven component, but capacity and cycle behavior need domain-level validation and coverage for fixed-per-batch, per-unit, and labour workers × duration × rate.
- Finished products are not represented as a separate bakery product domain linked to recipes; the recipe/material distinction exists, but product profitability and sellable-unit mapping are missing.
- No automated tests cover API authorization/validation, nested recipes, invalid UOMs, historical snapshots, inventory transactions, purchasing, production, waste categories, or reports. The current four cost-engine tests are necessary but insufficient for the prompt's rule that every important calculation be tested.

## Recommended order after Gemini finishes

1. Replace money/unit calculations with a Decimal-based domain service and reject invalid conversions; add tests for all required formulas and error cases.
2. Add schema migrations and Phase 1 entities: suppliers, supplier-material purchase formats, price history, and reviewed legacy-item migration.
3. Make recipes versioned and recursively costed with circular-reference prevention and server-generated historical snapshots.
4. Implement inventory movement ledger, goods receiving, purchase requirements, and production batches as transactional workflows.
5. Add expected-vs-actual yield/consumption and complete waste categories/cost reporting.
6. Finish bakery dashboard and internal reports, then perform browser/accessibility/performance QA on the operational workflows.

This audit does not modify existing invoices or deploy anything. It is the review gate for the next implementation pass.
