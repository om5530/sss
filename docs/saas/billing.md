# Razorpay subscription billing — isolated test integration

This milestone wires Razorpay test subscription checkout, exact-attempt recovery, signed webhook intake, invoice/payment reconciliation, period-end cancellation and an owner billing interface. It remains behind the local SaaS/database guard. **Live keys are rejected, production billing is not enabled, and no production payment/data was accessed.** Automated tests substitute synthetic provider responses; real Razorpay sandbox validation still requires separately configured credentials and plans.

## Dedicated configuration

The integration does not reuse legacy `RAZORPAY_*` or `STRIPE_*` credentials. Explicitly configure all of these in a disposable local test environment:

| Variable | Purpose |
|---|---|
| `SAAS_RAZORPAY_TEST_ENABLED=true` | Explicit opt-in |
| `SAAS_RAZORPAY_TEST_KEY_ID` | Dedicated `rzp_test_…` key ID; live key IDs fail |
| `SAAS_RAZORPAY_TEST_KEY_SECRET` | Its API secret, kept server-side |
| `SAAS_RAZORPAY_TEST_WEBHOOK_SECRET` | Separate webhook signing secret, at least 32 characters |
| `SAAS_RAZORPAY_TEST_ACCOUNT_ID` | Exact `acc_…` account ID expected in signed events |
| `SAAS_RAZORPAY_TEST_STARTER_PLAN` | Test `plan_…` mapped to Starter |
| `SAAS_RAZORPAY_TEST_GROWTH_PLAN` | Different test `plan_…` mapped to Growth |

Each mapped plan must be INR, monthly, interval 1, with a positive integer amount within the supported range. The owner reviews the amount fetched from Razorpay; no commercial price was invented or published. Each subscription uses quantity 1 and a maximum of 12 monthly cycles, displayed before confirmation. Authorization links expire after one hour. No contacts or emails are submitted by this app, and creation explicitly sets `customer_notify:false`.

`billingConnected` remains false for production billing. `testBillingConfigured`/the billing status card indicate only that local configuration is present, not that a real provider round trip has passed. Never put these secrets in client code, plan-request files, logs or commits. No real account credentials were present during implementation.

## Checkout and uncertain responses

1. Owner requests the test plan catalogue, selects a plan and reviews the price/12-cycle contract and access consequence.
2. The browser retains the exact plan, reviewed amount and UUID reference in actor/bakery-scoped sessionStorage before any creation request. An unretained/corrupt or unresolved attempt blocks another checkout.
3. The server validates price again, takes the bakery authorization lock, persists a `creating` attempt and links the bakery to it. Workspace access becomes restricted until paid provider records are verified. Audit and local subscription history commit with that intent.
4. The provider create call runs **outside** MongoDB transactions, with the saved attempt/bakery/mode in server-controlled notes. No external request is repeated by a database transaction retry.
5. Successful creation binds the subscription ID and allowlisted HTTPS `rzp.io` authorization URL to that saved attempt.

Razorpay does not document a universal subscription-creation idempotency header, so this implementation never invents one. If a response/attachment is lost, the creating attempt stays unresolved and an identical retry **does not issue a second create request**. The owner can recover the existing subscription ID from the dedicated test dashboard. Recovery fetches it using the test API and requires exact server-issued notes, plan, quantity, cycle count and integration match. Arbitrary provider IDs cannot link another bakery's subscription.

An existing current/unresolved subscription blocks another one. A later subscription can start only after the previous provider subscription is terminal and its verified paid period has ended. Replaying an older saved request confirms that original record; it never points it at a different contract. Mid-period switching/proration is not implemented.

## Paid access and invoices

Authorization links and browser success callbacks grant no access. Synchronization fetches the current subscription, all supported invoice rows (bounded below 100), and the latest eligible paid invoice's payment. It verifies:

- Exact test integration, subscription, plan, quantity, contract and server notes.
- Each invoice belongs to that subscription and uses INR/valid integer amounts.
- The selected invoice is fully paid with no amount due, covers a valid monthly period and includes at least the reviewed plan amount.
- Its referenced payment is captured, has the same invoice/currency, covers the amount and has no recorded refund.

Access ends at the verified **invoice billing end**, not an unverified later subscription `current_end`. Pending/halted renewal may use at most seven days' grace anchored to that verified paid end. Missing/mismatched/refunded payment proof restricts access; it is never treated as a successful payment. Paused/terminal subscriptions and confirmed renewal cancellations retain only the verified paid period. A terminal subscription cannot be revived by a later non-terminal snapshot.

The invoice cache whitelists references, status, amounts, period and safe URL; it excludes provider customer details, payment credentials and raw payloads. Subscription state, invoice cache, version, plan history and audit commit together. Concurrent snapshots use the reviewed checkout version: a stale result conflicts instead of replacing newer reconciliation. Billing invoices are separate from bakery order payments and event sales.

## Webhook inbox and worker

`POST /api/saas/billing/razorpay/webhook` preserves a bounded raw JSON body before the app's JSON parser. Its lazy environment/database guard executes before any SaaS model registration. It does not use the legacy order-payment webhook handlers.

The endpoint verifies HMAC-SHA256 over the original bytes, checks the dedicated account ID and requires `x-razorpay-event-id`. Known subscription notifications are durably queued with a payload digest and minimal references. Duplicate event IDs must have identical bytes and checkout identity. Raw provider/customer payloads are not retained, and the event itself grants no access.

Unknown/early unlinked events are ignored without using their notes to guess a tenant. Recovering an uncertain checkout and explicitly refreshing its provider status repairs that state. The current integration supports `subscription.*` notifications; other event types are ignored. Periodic status reconciliation is still needed for missed notifications and externally initiated refunds.

A bounded local worker drains the inbox using authoritative provider fetches:

```sh
npm run saas:billing-worker -- --uri mongodb://127.0.0.1:27017/saas_example --limit 5
```

It requires explicit local guards/configuration, uses a direct loopback connection and ignores default/production MongoDB URIs. Limit is 1–20 checkouts per invocation. Each checkout is atomic; failed work remains pending. Events received during a fetch stay pending for a subsequent pass. Obsolete subscriptions can drain their events without overwriting a newer bakery link. Worker output contains counts only.

No daemon, cron, public tunnel or provider Dashboard webhook was installed. Test delivery requires a separately controlled sandbox endpoint; never point test setup at the existing Golden Batch production application. Staging still needs durable scheduling, retries/alerts, missed-event reconciliation and provider latency/load validation.

## Cancellation

The owner reviews stopping renewals at the provider's current billing-cycle end. The server saves/audits the intent before the external cancellation call. It sends only `cancel_at_cycle_end:true`; no subscription refund or new charge is initiated. Successful acknowledgement is recorded and reconciliation preserves verified paid access through its paid end.

Lost cancellation responses stay uncertain. An immediate concurrent retry is blocked while the request is pending; after the bounded pending interval, an explicit retry may repeat the same stop-renewal instruction. A confirmed/terminal cancellation replays without another provider mutation. A provider cancellation that succeeds while local attachment fails needs refresh/retry; it is never reported as definitely failed.

## Owner API and interface

All bakery endpoints below require fresh owner authorization, no-store responses and the guarded local database. Mutations additionally require the documented confirmation/version/reference fields. Staff/customer/global roles do not bypass bakery ownership. Provider calls are limited per authenticated actor.

| Method | Suffix under `/api/saas/bakeries/:bakeryId/billing` |
|---|---|
| GET | Empty suffix: cached current checkout and test configuration status |
| GET | `/catalog`: fetched test prices/terms |
| POST | `/checkout`: confirmed plan/reviewed amount/UUID |
| POST | `/recover`: confirmed saved checkout and matching provider subscription ID |
| POST | `/synchronize`: authoritative provider/invoice/payment refresh |
| POST | `/cancel`: confirmed reviewed checkout version |
| GET | `/invoices`: cached invoices, 20/page and optional ObjectId cursor |

Menu settings has a separate hidden-by-default **Subscription billing · Test mode** panel. It supports review/confirmation, pending-attempt restoration, recovery, provider refresh, stop-renewal confirmation and invoice history. Safe links open only after an explicit click. Hiding/page visibility loss clears loaded billing data; delayed responses cannot reveal another bakery. Recovery is cleared only for confirmed ready checkout or a definitive no-saved-key price/current-contract rejection; uncertain responses and key conflicts retain it.

A provider-linked bakery cannot be overridden by the earlier manual local plan command. Source-of-truth changes must use billing reconciliation; no HTTP endpoint grants a paid plan directly.

## Remaining before item 1 can be considered finished

- Supply dedicated test credentials/account/plan mappings and run real sandbox authorization, renewal, failed-payment, webhook and cancellation checks.
- Finalize prices/quotas, tax/legal invoicing and contract/retention policy.
- Decide mid-period upgrades/downgrades, proration, dispute/refund and mandate-recovery workflows.
- Add production owner identity, production provider configuration, scheduled durable processing/reconciliation, monitoring and staging/browser end-to-end evidence.

Live-mode rollout remains deliberately blocked. Neither successful synthetic tests nor present environment keys constitute real billing acceptance.

## Primary provider references

- https://razorpay.com/docs/api/payments/subscriptions/create-subscription
- https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription
- https://razorpay.com/docs/api/payments/subscriptions/fetch-invoices
- https://razorpay.com/docs/api/payments/subscriptions/entity
- https://razorpay.com/blog/payment-gateway-webhooks-india/

The installed Razorpay SDK's cancellation signature differs from its current documentation; this integration uses the documented fixed HTTPS API endpoints directly with bounded timeouts and redacted errors.
