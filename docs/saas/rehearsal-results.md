# Synthetic two-bakery API rehearsal

This automated journey uses real local HTTP endpoints and dedicated workspace/customer cookies across modules. It does not use the legacy workspace-auth bridge or global admin fixtures. It is an API integration rehearsal, not browser/iPad end-to-end acceptance or a deployment.

Run from server:

```sh
MONGOMS_VERSION=7.0.14 npm run test:rehearsal
```

The test creates its own disposable loopback MongoDB replica set named `saas_rehearsal_test`, runs the journey, closes the server and destroys the database. It never reads an external database URI, imports legacy records, sends email, transfers money or calls a billing provider. The image is generated from synthetic pixels. Owner recovery reads only the encrypted synthetic operator preview.

| Phase | Connected checks |
|---|---|
| Owner/staff onboarding | Three dedicated accounts, two separate bakery workspaces, reviewed invitation inspection/acceptance, staff scope and reciprocal foreign-workspace rejection. No legacy users/JWT bridge. |
| Recipe and production | Separate same-named products/materials, eight- and nine-piece revisions, selected mapping, foreign ingredient rejection, tracked material opening, reviewed production fingerprint and concurrent replay. Exactly 18 finished pieces and 200 g raw material remain after one two-batch run. Material repricing preserves old revision costs. |
| Brand/media/customer boundary | Different themes, one bakery's logo absent from the other, publication-gated image URL, canonical configured-origin local link, same-email customer accounts with different identities and cross-cookie/private-slot rejection. Public menu omits operational stock and revision identifiers. |
| Pickup | Foreign product/order rejection, concurrent customer submission creates one reservation, readiness cannot collect unpaid stock, manual settlement precedes collection, private customer history omits costs, cancellation restores claimed stock once. Saved order cost references the immutable selected revision despite material repricing. |
| Event bookkeeping | Staff sale, owner-only discount, concurrent manually recorded refund replay, separate unpaid sale and finished-product wastage. Received event money is 18,900 paise with 19,900 outstanding before final settlement; exactly 13 finished pieces remain. Staff/foreign owners cannot read private event reports. |
| Restricted plan | Synthetic plan transition blocks new products and customer checkout while allowing existing settlement and staff revocation. Event receipts become 38,800 paise with zero outstanding. Revoked staff retain their account session but lose bakery access. The other bakery retains five pieces and zero orders. |
| Recovery/suspension | Single-use owner reset revokes that owner's workspace session without signing in or clearing another owner, or changing customer sessions. New login remains unverified. Synthetic suspension blocks owner context, menu and a previously known logo URL while leaving the other bakery available. Legacy users/products/orders remain empty. |

The plan and suspension transitions are explicit fixture-only database changes after asserting the disposable database name. No platform operator endpoint or production migration path is added. All ordinary business mutations run through the actual HTTP API and its transaction/authorization controls.

This journey complements focused suites covering expiry, stock epochs, stale versions, corruption, quota concurrency, audit rollback, isolation and provider-test simulations. It does not replace those suites. A passing journey cannot prove every route/callback is isolated or that hosted operations are ready.

## Validation checkpoint

The full 340-check server suite, the focused eight-check connected rehearsal, and 172 client checks passed. The development build passed. Google Fonts returned HTTP 403 during the standard production build; an optimized production compilation with font inlining temporarily disabled passed, after which the original Angular configuration was restored. No font configuration change or deployment was committed.

## Remaining evidence

Real browser/iPad/mobile/accessibility and network-failure interaction testing, load/concurrency beyond deterministic regression cases, staging deployment/rollback and backup/restore remain pending. Email delivery and mailbox verification, billing sandbox acceptance, production object storage and shared abuse/monitoring also remain pending. More Tools, the Next.js rewrite and face privacy lock stay deferred. No production data or deployment was touched.

A separate synthetic cold backup/restore journey now checks archive integrity, index/BSON fidelity, occupied-target refusal, atomic insert rollback and restored account/order/media behavior; see `backup-restore-rehearsal.md`. It does not enable production backups.
