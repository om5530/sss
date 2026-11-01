# Local subscription and plan foundation

This milestone implements local plan state, effective access, capacity enforcement and operator change history. The subsequent separate Razorpay test integration is documented in `billing.md`; live billing is still disabled. It does not sell a subscription, contact a payment provider, receive a webhook or change production data. Starter and Growth are **unpriced draft fixtures**, not finalized commercial offers.

## Plan state and effective access

A bakery may have one bounded embedded `subscription` document. Existing/new local workspaces without it retain the original development policy; no automatic backfill, trial activation or claim of paid status is made. Changes increment a separate subscription version, independent of the bakery-name version and internal transaction lock counter.

| Stored state | Effective access |
|---|---|
| No configured subscription | Original development limits and normal development access |
| `trialing` | Trial access strictly before `trialEndsAt`; restricted at/after that instant |
| `active` | Access strictly before `currentPeriodEndsAt`; restricted afterward unless renewed explicitly |
| `past_due` | Grace access strictly before an explicitly recorded `graceEndsAt`; otherwise restricted |
| `cancelled` | Restricted immediately |
| Unknown/malformed plan/state | Restricted; no implicit paid entitlement |

Grace must end at/after the current period end and within seven days of it. `cancelAtPeriodEnd` is accepted only for active/trial states and retains access until that state's existing deadline. Expiry derives from the server clock without needing a background job; no scheduler updates the stored status automatically. Repeated operator renewal/trial changes are trusted local fixtures, not a production billing or fraud policy.

## Draft capacities

| Resource | Starter preview | Growth preview / existing development ceiling |
|---|---:|---:|
| Products | 100 | 500 |
| Materials | 250 | 1,000 |
| Recipe families | 100 | 500 |
| Revisions per family | 50 | 100 |
| Events | 100 | 500 |
| Orders | 2,500 | 10,000 |
| Production runs | 1,000 | 5,000 |
| Material movements | 10,000 | 50,000 |
| Finished-waste entries | 2,000 | 10,000 |
| Customer accounts | 1,000 | 5,000 |

These remain lifetime record ceilings, not monthly quotas. Archived/inactive/closed records count. Downgrading preserves all data and permits active-plan edits, but creation beyond the new ceiling fails until capacity/policy is resolved. Team limits remain the existing separate ceilings. Account-wide bakery limits, storage and commercial quota/pricing choices are still later work.

## Restricted access and recovery

Restricted plans pause new records and general changes: products/counts, materials, recipe mappings/revisions, production, inventory, new wastage, event creation, profile settings, bakery rename, staff invitations and new invitation acceptance. These guards use the current subscription inside the same bakery transaction lock as the business operation.

Existing work can still be completed or safely reconciled:

- Read existing records, owner reports, plan/history and usage.
- Confirm received money; correct discounts; record money already refunded manually.
- Mark existing pickup orders ready/collected under their normal payment/reservation rules.
- Cancel unpaid pickup reservations and release due holds conservatively.
- Close existing events and revoke staff/invitations.
- Access existing customer history and log out. Existing customer login and account recovery remain available when the menu is hidden (`customer-security.md`).
- Replay an already-persisted sale/customer order, production run, inventory movement or wastage submission before capacity rejection.

General writes are checked inside the transaction after the server callback. A restricted non-recovery result rolls back its data, stock movement and audit together; trusted server-produced `replayed:true` results may return an existing record. Recovery exceptions are explicit options at server call sites, never caller request flags. New records also pass plan-aware capacity checks before insertion. General writes and operator plan changes acquire the same bakery lock, so they serialize.

Customer menu/quote responses expose checkout availability, not subscription/payment status or plan limits. New customer order rejection says ordering is paused and uses the existing definitive `SALE_REJECTED` protocol only after proving no saved key exists. Normal customer registration is blocked at restriction; credentials and existing histories are not altered.

## Owner interface and API

Menu settings contains a **Show plan** panel. It reveals the local plan/access state, applicable dates, cancellation-at-period-end notice and paged change history. It starts hidden and clears on hide, bakery switch, page visibility loss, destruction or history access failure. Usage now reports the selected plan's effective limits while retaining its separate hidden count view. Loaded access is a snapshot; the server recalculates it for writes.

| Method | Path | Access |
|---|---|---|
| GET | `/api/saas/bakeries/:bakeryId/subscription` | Current owner; no-store; no filters |
| GET | `/api/saas/bakeries/:bakeryId/subscription/history` | Current owner; 20 changes/page; optional ObjectId `cursor` |

History omits actor IDs, operation keys and request hashes. Owners/staff/customer sessions have **no HTTP endpoint** that grants or changes a plan. Bakery/profile/product field whitelists reject injected subscription fields. This is not a customer-facing upgrade/checkout flow.

## Guarded local operator command

The command uses no dotenv or application boot and ignores `MONGODB_URI`. It requires explicit local development enablement and an explicitly supplied loopback `mongodb://` URI with a `saas_*` database. Credentials, cloud SRV, non-loopback hosts, remote-discovery options and other database names are rejected. It connects directly to the selected host. Dry runs disable automatic collection/index creation. SaaS models load only after the connection passes the database guard; `--apply` is required to write.

From `server`, with the local flag and development/test NODE_ENV already set:

```sh
npm run saas:subscription -- --uri mongodb://127.0.0.1:27017/saas_example --bakery-id OBJECT_ID --actor-id EXISTING_LOCAL_USER_ID --input plan-request.json
```

The default prints a dry-run before/after/policy result. Review it and append `--apply` to apply that exact request. A replica set is required for transactions. Example input (dates are illustrative and must be deliberately chosen):

```json
{
  "planId": "starter",
  "status": "trialing",
  "trialEndsAt": "2026-11-14T12:00:00.000Z",
  "currentPeriodEndsAt": null,
  "graceEndsAt": null,
  "cancelAtPeriodEnd": false,
  "expectedVersion": 0,
  "idempotencyKey": "11111111-1111-4111-8111-111111111111",
  "reason": "Disposable local trial scenario"
}
```

The existing local user ID identifies the operator in history/audit; possession of a normal user account does not provide an HTTP plan-changing capability. The operator's local process/database access is the trust boundary, not a production administrator role. There is no API or script to silently reset a configured subscription to the unconfigured development policy.

A unique bakery/operation key and bakery/subscription-version history accompany the embedded snapshot. Payload and actor bind the key. Identical retries return the recorded change and current policy before version checks; changed details conflict. Bakery state, append-only before/after history and `platform` audit metadata commit together. Audit failure rolls all changes back. Logs do not print connection strings or credentials.

## Remaining billing work

Commercial plan/pricing decisions, owner onboarding, provider checkout/customer/subscription linkage, verified replay-safe webhooks, renewals, failed-payment handling, real invoices, platform roles, billing support and reconciliation remain unimplemented. No real charge, refund or provider event is simulated as settled. Production identity, shared throttling, backups/monitoring, browser QA and staging rollout remain separate launch blockers.
