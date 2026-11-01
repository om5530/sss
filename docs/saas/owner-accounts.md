# Dedicated workspace accounts and onboarding

This milestone runs only inside the existing isolated local SaaS guard. It creates no production accounts, modifies no legacy users, and enables no hosted signup.

## Local flow

Open `/saas-account` in the development client. Create an owner/staff account with a name, email identifier and a 12–128-character password; review before confirming. Registration creates an account and session only. Open `/saas-lab` to review and create a bakery, or review an owner-issued staff invitation. Each bakery has its own membership; an account can create at most five workspaces, including suspended workspaces. Concurrent creation is serialized under the account lock.

The bakery creation review freezes the name and slug. If its response is lost, reload the bakery list before retrying. The unique slug prevents creating a second bakery with the same reviewed slug. Existing legacy memberships are not automatically linked by email or migrated. New accounts have no legacy JWT or global admin role. Bakery customers remain a separate identity domain, even with the same email.

## Sessions and account security

Passwords use the existing versioned scrypt implementation. Workspace sessions use random opaque tokens; only their SHA-256 digests are stored. The HttpOnly, SameSite Strict cookie is scoped to `/api/saas`; local HTTP cookies are not Secure. Sessions expire after 12 hours, at most five are retained, and expiry is checked on every request independently of TTL cleanup. Account settings show bounded session creation/expiry metadata, never token hashes.

Workspace mutations require an explicit intent header and an allowed Origin when present. Requests also send the expected workspace account ID, preventing a different account signed in through another tab from accidentally receiving a pending operation. An expired or malformed cookie never falls back to legacy credentials. The client removes legacy bearer authentication from workspace requests once dedicated account identity is restored.

Changing a password requires the current password and a reviewed confirmation. Its transaction rechecks the current hash and session, increments the session version and revokes all workspace sessions across bakeries. Logout revokes only the selected session, is idempotent, and checks the expected account before clearing its cookie. Registration, login, logout and password changes write account-security audit metadata atomically. A lost logout response retains client identity so the user can retry or restore the session.

Tenant writes recheck the active account, session and typed membership within their transaction. Memberships and accepted invitations distinguish `saas` and `legacy` identities; identical ObjectIds cannot authorize another identity domain. Existing unique indexes are retained. Bakery creation locks the account; tenant operations lock the bakery, then account, then membership. Security operations do not acquire bakery locks.

## Development compatibility

`SAAS_LEGACY_WORKSPACE_AUTH=true` is an explicit development/test fixture bridge, off by default. Even when set, it requires the full local foundation guard and a completely absent workspace cookie. It permits existing legacy API fixtures with real bakery memberships, never a global-role bypass. The development UI uses the dedicated account guard, not this bridge. It is not a migration or production authentication policy.

## Remaining release work

Email ownership stays `false`: entering an email is not verification, and no email is sent. Local owner password reset and encrypted verification previews now exist (`owner-recovery.md`), including single-use proofs and session revocation. Verified contact/recovery delivery and production abuse handling with shared durable limits, production TLS/cookie/host policy, MFA decisions, account suspension/support and ownership transfer remain pending. Do not use the customer-only local recovery preview to claim owner recovery. There is no automatic delivery or paid-provider activation.

The development routes remain excluded from production Angular builds. The server still rejects production/Vercel/cloud database configurations before loading SaaS models. Dedicated staging, real-browser/iPad/accessibility checks, operational restore/rollback evidence and a reviewed rollout are still required.
