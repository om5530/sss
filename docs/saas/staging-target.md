# Isolated hosted test target

The user authorized this separate hosted test environment and explicitly approved storing its test-only credentials in Vercel and allowing Atlas connections from any IP. Existing Golden Batch production code, hosting and data must remain untouched. More Tools, Next.js migration, face lock, monitoring and additional abuse controls remain deferred.

## Resources

- Atlas organization: `6a281a5f4d41b8022ca34b0d`.
- Separate Atlas project: `Golden Batch SaaS Test`, ID `6ae612c9b428ce9448578ade`.
- Free AWS Mumbai cluster: `golden-batch-saas-test`, ID `6ae612e8018c8af9f304cda9`.
- Database: **`saas_staging`**. No production records were copied.
- SRV hostname: `golden-batch-saas-test.scy3xst.mongodb.net`.
- Application user: `saas-staging-app`, scoped to this cluster with read/write on this database only.
- Test project network access: user-approved `0.0.0.0/0` for Vercel dynamic egress. Revisit when a fixed-egress deployment is available.
- Separate Vercel project: `golden-batch-saas-test`, ID `prj_zDxs66Go3gVAi67hchKIsVbbPjr3`.
- Vercel team: `team_nHyNtzGGxhVotQgwHRGmKv0D`.
- Stable alias: https://golden-batch-saas-test.vercel.app/saas-account
- Deployment: `dpl_38vG5ME3v4wx6TUTAGDnEtjQSjNc`, ready on 31 October 2026.

Vercel's `production` environment label belongs only to this separate test project. It does not mean the existing live Golden Batch project. Deployment Protection is retained. Temporary share tokens and database credentials are never committed here.

## Runtime boundary

`api/saas-staging.js` loads a separate SaaS-only Express application. It reads only `SAAS_STAGING_MONGODB_URI`, checks the exact Vercel project ID, exact test SRV hostname, database name and resolved shard hosts, and rejects unexpected request origins. Secure, HttpOnly cookies are used over HTTPS. The legacy API entry and base Vercel configuration are unchanged.

Required variables are configured on the test project only:

- `SAAS_STAGING_ENABLED=true`
- `SAAS_STAGING_MONGODB_URI` (sensitive, generated test credentials)
- `SAAS_LEGACY_WORKSPACE_AUTH=false`

The client uses the `saas-staging` build profile, same-origin `/api`, SaaS-only routing, no service worker and no Google/Firebase login configuration. The user requested the production appearance for testing: the workspace reuses the production operations sidebar, responsive drawer and light/dark themes, with branded account screens and customer menu cards. Developer headings and the global test banner are removed. Canonical entry points are `/account` and `/workspace`; older SaaS links redirect. This appearance does not change the isolated runtime or database boundary.

Legacy login/admin/payment APIs are absent from the staging runtime. Real email delivery, online provider payments and durable image storage are not enabled. Unsupported image upload, local recovery-preview and test-billing tools are hidden in the hosted UI. Local image files cannot be persisted in a serverless function.

## Reproduce the deployment source

```sh
npm --prefix client run build -- --configuration saas-staging --output-path /tmp/saas-staging-dist
python3 scripts/package-saas-staging.py /tmp/saas-staging-dist /tmp/saas-staging-release
```

Use a fresh packaging folder outside the repository. The package includes precompiled static files, the dedicated API entry, server source and locked runtime dependencies. Root package metadata ensures Vercel installs dependencies before tracing the function. API routes use capture-free rewrites so platform path parameters cannot pollute validated query filters. It excludes `.env`, node_modules, runtime data, Git metadata, personal uploads and the legacy API entry. Deploy this bundle only to the project ID above, with Node.js 22 and Mumbai functions.

## Validation

- Staging client build passes.
- Client unit tests: 173 pass.
- Staging guard/API boundary tests: 4 pass; exact-project/URI/host enforcement secure cookies, origin checks and legacy-route rejection are covered without cloud writes.
- Browser renders the protected hosted workspace account page.
- Hosted unauthenticated API returns application JSON 401 after passing the isolated database connection guard.
- Hosted synthetic smoke check: 13 requests passed on the final deployment, covering two account registrations, workspace creation, owner product access, cross-bakery denial (404), logout/session revocation, login, persistence, public menu data and legacy admin-route rejection. Both test sessions were signed out.
- Product creation, publication, menu-link generation and browser rendering were also verified using fictional test records. No real email or provider payment was sent.
- Final deployment error/fatal log scan: no matching errors during the successful smoke check. Use only fictional records for further testing.
