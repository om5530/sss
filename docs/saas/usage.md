# Development usage ceilings

The local SaaS prototype enforces server-owned limits per bakery. Configured local plan previews can lower these limits (`subscriptions.md`); unconfigured workspaces retain the development ceilings below. These ceilings bound prototype data growth; they are not subscription tiers, paid entitlements or production capacity estimates.

| Resource | Limit | Records counted |
|---|---:|---|
| Products | 500 | Active and archived |
| Materials | 1,000 | Active and inactive |
| Recipe families | 500 | Active and archived |
| Revisions per recipe family | 100 | Immutable revisions in that family |
| Events | 500 | Open and closed |
| Orders | 10,000 | Paid, unpaid and complimentary |
| Production runs | 5,000 | Immutable completed-run entries |
| Material movements | 50,000 | Openings, receipts, counts, raw waste and production deductions |
| Finished-waste entries | 10,000 | Immutable product-wastage records |
| Customer accounts | 5,000 | Active and inactive accounts in this bakery |

Existing team invitation/member limits remain separate: 20 active pending invitations and 50 active memberships including the owner. Account-wide bakery creation, distributed request throughput, exports, payment/correction histories, storage and platform billing still need their own policies. Customer checkout additionally limits three unpaid orders and five sessions per account, with in-process authentication/checkout rate limits (`customers.md`). These development ceilings do not provide full abuse prevention or commercial quota enforcement.

## Enforcement

`plan-policy.js` owns the frozen ceilings and draft plan limits; `usage-limits.js` enforces the current policy. Client fields, tenant settings and deployment environment values cannot increase it. Capacity checks run inside the same owner/member transaction as insertion, after acquiring the bakery authorization lock. Two callers cannot both claim the final slot. Counts include archived/inactive/closed records, so changing state does not bypass a ceiling. Records are not deleted to recover capacity.

At capacity, new creation receives 409 with `details.code=SAAS_LIMIT_REACHED`, resource and limit. A new sale instead carries `SALE_REJECTED`, because its transaction has proven no order exists for the submission key; this allows the counter’s recovery record to be cleared safely. The explanatory message still identifies the limit.

Existing records remain editable. Order settlement, manual refund records, discount corrections and event closure remain available. Identical sale retries resolve before checking order capacity, including at the ceiling, without consuming another stock unit or number. Restricted subscription access additionally pauses general writes while explicitly preserving existing order/payment/revocation recovery. The rules do not inspect or mutate legacy business collections.

## Owner usage view

`GET /api/saas/bakeries/:bakeryId/usage` returns a consistent snapshot of tenant counts and current plan limits; policy is `development` or `subscription-preview`. It is owner-only, no-store, accepts no query parameters and returns no record IDs, costs, customer data or finance values. Cross-bakery access fails under the same verified membership rules as other SaaS routes.

Menu settings includes a **Show usage** button. Counts stay hidden until requested and clear on bakery changes, hide, page visibility loss or destruction. Late responses cannot restore a hidden report or display another bakery’s counts. Refresh requests replace cached counts and clear them on access loss. The revision ceiling is displayed separately because it applies per family.

## Verification and remaining work

Synthetic loopback integration tests cover tenant scope, owner/staff access, concurrent final product slots, archived/inactive/closed counting, immutable revision history, updates at capacity, and sale replay/settlement at the order limit. No production database, backfill or migration is used.

Before production: define commercial limits and retention policies; add durable account signup and request throttling, provider/storage limits and operational alerts; measure the serialized write path under representative load. Do not infer that changing these constants is sufficient to enable production SaaS.
