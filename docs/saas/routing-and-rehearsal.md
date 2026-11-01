# Local tenant URLs and rehearsal preparation

The first pilot URL strategy is a bakery slug in the path. Its local implementation and offline configuration preflight do not enable hosted staging, custom domains, production routes or cloud database connections.

## Canonical menus

`/b/:slug` is the canonical development menu; old `/saas-menu/:slug` links redirect there. Both hide legacy storefront navigation/footer and remain excluded from production Angular routes. Customer and versioned image APIs/cookie paths retain `/api/saas/storefront/:slug/...`. Nothing migrates sessions or broadens customer access.

In Menu settings an owner can open, request and explicitly copy a canonical local link. A link does not publish a draft menu. `GET /api/saas/bakeries/:bakeryId/storefront-link` requires live owner membership, takes the slug from verified bakery context, and takes the origin from `SAAS_LOCAL_PUBLIC_ORIGIN` or, when that override is absent, configured `CLIENT_URL`. Only an exact loopback HTTP(S) origin such as `http://localhost:4200` is accepted. Paths, queries, fragments, credentials and nonlocal origins return 503. Caller-supplied origin/tenant selectors are rejected.

Forwarded Host/Forwarded headers neither generate links nor select tenants. Before lazy SaaS model loading, the server accepts only `localhost`, `127.0.0.1` or `[::1]` Host authorities with an optional valid port. The same check applies to the separate test billing webhook. Legacy routes are unchanged. Local proxies must deliberately preserve a loopback upstream Host; public tunnels and custom-host forwarding are not implicitly trusted.

The client independently checks returned links against the expected bakery path and a loopback web origin, without credentials/query/fragment. Reloading or changing bakery clears links and ignores late responses. Copying needs a separate click; clipboard errors leave a selectable link. No session token or credential is placed in a link or browser storage.

## Offline preflight

```sh
cd server
npm run saas:rehearsal-preflight -- --config ../docs/saas/rehearsal.example.json
```

The command reads only the explicit regular JSON file, at most 16 KiB. It never loads dotenv, imports a database driver, uses ambient MONGODB_URI, connects, contacts a provider, writes environment configuration or deploys. Supply no secrets: diagnostics do not echo rejected values.

The exact fields are schemaVersion `1`, mode `local-rehearsal`, an explicit credential-free loopback `saas_*` MongoDB databaseUri (optional replicaSet only), loopback HTTP(S) publicOrigin/apiOrigin with no paths/credentials, dataSource `synthetic`, deployTarget `none`, billingMode `disabled` or `test`, and ownerMailDelivery/customerMailDelivery both `local-preview`. Missing/extra fields or unsafe values set exit code 1.

A valid example returns readyForLocalConfiguration:true, always readyForHostedStaging:false and readyForProduction:false. This static configuration result is not a connection, provider acceptance, browser check, deployment authorization or proof of runtime readiness.

## Runtime rehearsal

The separate `npm run test:rehearsal` creates and destroys its own synthetic loopback memory replica set. It never accepts an external URI. Results and limits are documented in `rehearsal-results.md`. Passing the API journey does not change the offline preflight's readiness flags.

Hosted staging still requires a reviewed deployment/database boundary, a separate synthetic staging database, chosen application/API origins, TLS/cookie policy, durable storage/abuse/monitoring, backup/restore, actual email delivery and billing sandbox evidence as applicable. Browser/iPad/accessibility evidence remains pending. Existing guards continue to reject production/staging NODE_ENV values, Vercel and cloud databases.
