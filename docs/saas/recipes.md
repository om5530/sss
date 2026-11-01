# Tenant recipes and product mapping

This module is available only in the isolated local SaaS workspace. It does not read, copy or update legacy bakery materials, recipes, revisions or product mappings.

## Access and data boundaries

Materials and recipe costs are owner-only. Staff can see the product's recipe identifiers but cannot access private ingredient or cost details. Every lookup includes the verified bakery ID, including references inside revision creation and product mapping. A global legacy admin does not bypass membership.

New shared collections: `saas_materials`, `saas_recipes`, `saas_recipe_revisions`. Every record has a required bakery ID. Revisions are separate documents so recipe history is not an unbounded embedded array. The revision index is unique on bakery, recipe and revision number; lists use bounded pagination.

## Materials and costing

Materials store a pack quantity as a decimal string, a supported pack unit and an integer pack price in paise. The client enters rupees, converts to integer paise without rounding and the server validates all inputs. Quantities allow up to six decimal places. Cost arithmetic reuses the existing pure Decimal engine with 40-digit precision.

A formula specifies material IDs, expected material versions, quantities and units. The server resolves active materials from the same bakery and calculates each line, batch cost and per-piece cost. Client cost overrides are rejected. Dimension conversions such as kg to g and hour to minute are supported; mass/volume conversion without density is rejected. Nested sub-recipes, stepped oven capacity rules and inventory consumption are not part of this first tenant recipe flow.

For example, an oven pack of 16 minutes at ₹16 costs ₹50 for an explicitly requested 50 minutes. The engine does not invent a 180-minute cycle. Extra per-batch overhead is a separate integer-paise amount.

## Revision behavior

Creating a recipe creates revision 1. Each new revision stores its own yield, ingredient quantities and immutable material name/pack/price/version snapshots. Changing a material price affects newly created revisions only. A stale material or recipe version returns 409, allowing the owner to review changed prices before saving.

Revisions cannot be edited or deleted through this API. The recipe family groups them under one recipe. Two simultaneous revision requests with the same family version produce one saved revision and one conflict, rather than duplicate revision numbers.

## Product mapping

Each product has one `recipeId` and one `recipeRevisionId`, updated together through a dedicated version-checked mapping route. Mapping does not change the product selling price, alter a saved revision, or automatically select a newer revision. Creating a revision leaves all existing product mappings unchanged.

A revision from another bakery is rejected. Archived recipes cannot receive new revisions or new mappings. A mapped recipe family cannot be archived until its products are unmapped. Archived products may be unmapped, but must be restored before linking a different revision. Archive/restore and material edits are version checked. Hard deletion is unavailable.

## Routes

All routes are under `/api/saas/bakeries/:bakeryId` and require active owner membership:

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/materials` | Paginated materials / create pack pricing |
| PATCH | `/materials/:materialId` | Change material fields with expectedVersion |
| GET / POST | `/recipes` | Paginated recipe families / create family plus first revision |
| GET | `/recipes/:recipeId` | Family plus revisions; limit and before paginate history |
| PATCH | `/recipes/:recipeId` | Name, category or archived flag with expectedVersion |
| POST | `/recipes/:recipeId/revisions` | Create another immutable formula revision |
| PATCH | `/products/:productId/recipe-mapping` | `{revisionId, expectedVersion}`; null clears mapping |

Mutations and metadata-only security audit entries commit in one transaction. Revoked owner membership, suspended bakeries and failed audit writes abort the transaction. The development workspace includes materials/pack pricing, grouped revisions, and explicit product mapping controls. Currency shown in cost summaries is for presentation; persisted cost strings retain full Decimal precision.
