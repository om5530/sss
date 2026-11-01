# Offline migration preflight

This tool reads an explicit JSON file and produces a review manifest. It has no MongoDB imports, environment loading, network calls, export command or apply mode. It does not change the source JSON or any database. Only synthetic fixtures were used during implementation.

## Try the synthetic example

From `server`:

```sh
npm run saas:plan -- --input test/fixtures/saas-legacy-synthetic.json --bakery-id 100000000000000000000001 --output /tmp/new-saas-manifest.json
```

Use a new output filename each time: existing files and symlinks are never overwritten. Omit `--output` to print the manifest. Exit codes: 0 means ready for manual review; 2 means blockers were found; 1 means invalid input or file/argument failure. `canApply` is always false, including a clean plan. The bakery ID is a proposed destination, not proof that it exists or that the caller owns it.

## Input and checks

The snapshot envelope is `{ "formatVersion": 1, "collections": { "ModelName": [] } }`. Include all 28 legacy models by model name, explicitly using empty arrays for empty collections. Unknown or omitted models block the plan. This prevents a partial export from silently looking complete. New SaaS models are not legacy sources.

The fixture includes a zero-total discounted order, its original cost snapshot, recipe revision and payment. These amounts must remain unchanged regardless of current menu prices. Canonical Extended JSON values such as `{"$oid":"..."}`, `{"$numberDecimal":"60.0000"}` and date wrappers remain untouched. Non-JSON values, cycles and excessive nesting are rejected.

The manifest records SHA-256 checksums for the whole snapshot, each collection and each document. Collection/document order is normalized in the collection-level checksum; the whole-snapshot checksum also detects changed array order. Names, contact details, descriptions, raw financial values, payment IDs and credentials are not copied into the report. Treat the report as internal metadata because it contains record identifiers.

Checks include duplicate/malformed IDs, conflicting tenant assignments, declared unique-key collisions, and declared references. Missing live references block; dangling historical references warn so snapshots can be reviewed without rewriting history. This is not full model/schema validation or an exhaustive reference audit. Mixed payloads, archived/deleted records and custom legacy fields need additional review.

## Decisions deliberately left manual

- Verify the destination bakery, owner identity and exact source dataset.
- Resolve customer identity, staff memberships, singleton settings and counter namespacing.
- Exclude legacy sessions/OTP challenges; do not carry them into new tenant sessions.
- Define tenant-scoped indexes and safe import adapters for each business module.
- Preserve source snapshots and provider identifiers. Do not recost historical sales.
- Test imports and reconciliation against a separate disposable database before designing a production rollout.

No production export, import, backfill, index change or migration has been run or authorized by this development workflow.

## Product conversion and reconciliation preview

`server/src/saas/product-import-preview.js` exports two pure functions:

```js
const { previewProductImport, reconcileProductImport } = require('./src/saas/product-import-preview');
const preview = previewProductImport(syntheticSnapshot, proposedBakeryId);
const report = reconcileProductImport(syntheticSnapshot, proposedBakeryId, syntheticTargetProducts);
```

The preview first runs the whole-snapshot preflight. If it is blocked, no product candidates are produced. Candidate documents reuse source IDs, add the proposed bakery ID and schema version, and convert rupees to integer paise without silently rounding. The same product-field validator serves both the API and preview. Existing order prices, discounts, costs, recipe revisions and payments are never recalculated or rewritten.

Non-empty photos/tags/review statistics, soft-deleted products and unknown product fields block conversion until their import policy is implemented. Category IDs generate a policy warning because the new catalogue currently retains category labels only. Invalid null availability/dietary values and prices with excess precision require review. UTC timestamps and supported Extended JSON wrappers are normalized for comparison; raw source checksums retain original representations.

Reconciliation regenerates expected documents from the source snapshot, rather than trusting an editable preview as its authority. It reports missing, duplicate, extra, foreign-tenant or changed target records without proposing corrections or deletions. Reports contain differing field names, not their raw values. Only a complete match returns `status: 'matched'`; `canApply` remains false. These functions never connect to a database and have only been exercised with synthetic data.
