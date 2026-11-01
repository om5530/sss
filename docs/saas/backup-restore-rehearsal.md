# Synthetic cold backup and restore rehearsal

This milestone tests recovery of the guarded local SaaS prototype using generated data. It is not a production backup service, an import/migration command or permission to access an existing database.

Run from server:

```sh
MONGOMS_VERSION=7.0.14 npm run test:backup-rehearsal
```

The test accepts no external URI, archive path, credentials or database name. It creates two independent disposable memory replica sets and uses only generated `saas_backup_rehearsal_*` databases. Existing `MONGODB_URI` and production connections are not used. The source application server is closed before export, and the original source database process/files are destroyed before the target is started. Both test database servers and the private temporary archive directory are removed during cleanup.

## Archive format and limits

`rehearsal-archive.js` is a rehearsal-only codec with no network, filesystem, connection or restore endpoint. It has an explicit allowlist of all 25 current persistent SaaS collections and an explicit exclusion list for seven ephemeral authority collections. A model inventory test fails if a future SaaS collection is silently omitted. Legacy records are excluded; a synthetic legacy sentinel is deliberately created in the source and checked absent after restore.

The archive includes the exact collection list, index specifications, canonical Extended JSON documents and a SHA-256 manifest checksum. ObjectIds, dates, BSON numeric types and binary image bytes are retained. The data read runs in a snapshot transaction after quiescing the application; index metadata is captured outside that transaction while the synthetic schema is idle. Index key order and relevant uniqueness/partial/TTL/collation options are preserved; server-generated index metadata such as index format version is not a compatibility guarantee.

The codec uses AES-256-GCM with a random 32-byte key, random IV and authenticated format header. The encrypted temporary file is created exclusively with mode 0600. Only ciphertext is written; the key stays in test-process memory and is wiped during cleanup. The archive is limited to 16 MiB of plaintext and 10,000 documents per table. Wrong keys, altered/truncated ciphertext, unknown/duplicate/missing collections, inconsistent checksums, duplicate document IDs and unsupported index options fail validation.

This fixture format and bounded codec are not a replacement for managed snapshots or MongoDB Database Tools. They do not provide live oplog/point-in-time recovery, cross-version/sharded recovery, incremental export, offsite durability, retention, production encryption-key custody or independent backup verification.

## Restore controls

The restore helper exists only inside the synthetic test. It checks the generated database namespace and refuses any target that already has a collection, including a target holding only an empty collection. It never drops or overwrites a target. The archive and all security transformations are validated before target creation.

Collections and indexes are created before the insert transaction. All restored documents are then inserted in one transaction. An intentionally duplicated unique product key proves that a failed insert rolls back every restored document. Created namespaces/indexes can remain after this intentional failure, so retry requires a fresh disposable target; those namespaces are destroyed with the owned test server. This is document atomicity, not transactional rollback of the preceding DDL.

Recovery applies these explicit holds:

- Workspace/customer sessions, reset/verification actions, encrypted mail previews and staff invitations are not restored.
- Workspace/customer account session versions are incremented. Restored password hashes still allow a fresh login; no replacement session is minted automatically.
- Storefronts restore unpublished with customer ordering disabled, and their setting version is incremented. Publication requires a separate owner review after recovery.
- Memberships, prices, costs, stock epochs, histories, ledger entries and original reservation deadlines are preserved. Email ownership is not promoted from preview confirmation.

Every persistent document and index is compared against the expected result after these transformations, before the restored application is allowed to create new login/audit activity. This includes protected cost snapshots, password hashes, order idempotency fields and image pixels that ordinary API responses omit.

## Observed application checks

| Check | Expected and verified behavior |
|---|---|
| Original database gone | Restore uses only the encrypted file, runtime key and a new independent memory server. |
| Archive integrity | Corruption/wrong keys fail before a restore; legacy and ephemeral authority data are absent. |
| Target safety | An occupied target's sentinel is unchanged; duplicate-key failure leaves zero restored documents. |
| Index/data fidelity | All 25 persistent tables and semantic index specifications match expected transformed data, including BSON dates/ObjectIds and two WebP images. |
| Login and isolation | Source workspace/customer cookies return 401. Fresh dedicated owner logins work; reciprocal foreign-bakery context reads return 404. |
| Money/cost history | A paid order still records 39,800 paise received with zero due, one receipt entry and the original 5,600-paise recipe batch-cost snapshot. No gateway or bank is contacted. |
| Stock/reservation history | Restored finished stock is seven pieces and material stock is 1,000 g. The existing unpaid reservation remains in the customer's history; explicit owner cancellation reconciles the claimed piece back to eight. |
| Publication | The restored menu is unavailable, ordering is disabled, and its setting version is advanced. Private image preview still decodes correctly for its owner. |

The seed flow uses actual dedicated owner/customer HTTP APIs, two bakery workspaces, materials, immutable recipe mapping, inventory, an event, a paid order/receipt, a pickup reservation, publication settings, logo/product images and pending invitation/recovery previews. It never enables legacy workspace authentication.

## Validation checkpoint

All six focused cold backup/restore checks and the full 346-check server suite passed. No frontend build or browser pass is claimed for this server/test-only milestone.

## Remaining production recovery work

Provider reconciliation is not proven: billing collections are present in the format but empty in this synthetic fixture. Live payment state, webhook inbox/leases, external media/object stores, scheduled jobs and outgoing delivery must be held and reconciled before a real restore can resume operations. Unpaid reservations, expiry and physical stock/handovers also need a defined recovery policy for the actual recovery point.

A production design still needs an authorized operator workflow, managed/offsite backups, key management and retention, scheduling/alerting, access controls and restore audit, isolated staging, fault/load testing and measured recovery objectives. Browser/iPad QA and actual email/billing provider acceptance remain pending. No production database, collection, backup, key, domain or deployment was accessed or changed.

Primary references: [MongoDB canonical Extended JSON](https://www.mongodb.com/docs/drivers/node/current/data-formats/extended-json/), [read concerns](https://www.mongodb.com/docs/manual/reference/read-concern/) and [transactions](https://www.mongodb.com/docs/drivers/node/v6.x/crud/transactions/).
