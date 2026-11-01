# Workspace account recovery and verification previews

Local owner/staff account recovery is independent of bakery customers and legacy users. The implementation uses only the guarded loopback `saas_*` database, creates no production accounts, and sends no email. A real delivery provider remains a release prerequisite.

## Recovery flow

The `/saas-account` page includes a local recovery panel. Request a reset preview with the workspace account email identifier. Eligible, unknown, inactive and cooldown-limited requests return the same public success body, without a token, account ID or preview ID. This protects response contents; it does not promise constant-time request timing. Missing preview configuration returns a uniform 503 before account lookup.

Reset proofs expire after 15 minutes; verification-preview proofs after 30 minutes. A 60-second account/purpose issuance cooldown limits replacement. After the cooldown a replacement consumes earlier proofs and deletes their previews for that purpose. Proofs are bound to the dedicated account, delivery mode, purpose, active state and session version; explicit validity checks govern use independently of TTL deletion. Each random 256-bit token is stored only as a SHA-256 digest.

Reset confirmation requires the token, a 12–128-character new password and explicit review confirmation. It atomically updates the scrypt password hash, increments the account session version, deletes all sessions for that owner/staff account across workspaces, consumes all pending account proofs and removes their previews. It neither creates a replacement session nor clears a different current account's cookie. Existing bakery records, memberships, customer passwords/sessions, legacy users and business-operation recovery are preserved.

Concurrent confirmations consume a token once. Audit failure rolls back password, session revocation, consumption and preview deletion together. Normal current-password changes also invalidate pending reset and verification proofs. Confirmation does not require preview decryption configuration once the bearer token is known.

## Verification preview

A signed-in account requests its own verification preview using a live cookie plus expected account ID. Confirmation records `emailPreviewConfirmedAt` only; **`emailVerified` remains false**. Possession of an operator-generated preview is not proof that a person controls the email mailbox. Preview confirmation does not create a session or switch the browser's current account. Reset and verification proofs cannot substitute for one another, and customer proof collections are separate.

The UI reviews each credential/proof action, disables concurrent account mutations and clears token/password fields before submission, on cancellation, account changes and destruction. Late responses do not replace a different account. Requests have a 20-second deadline and never automatically repeat a credential change. An uncertain response advises trying sign-in before requesting another proof. Tokens/passwords never enter URL parameters or browser storage. After a confirmed action, the client restores the existing cookie identity; resetting another account must preserve the current one.

## Encrypted operator previews

Set `SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY` in the isolated local environment to an explicitly generated 32-byte key encoded as 64 hex characters. It is separate from the customer preview configuration. Do not commit the key or expose it in browser configuration. No key is generated or saved automatically.

`saas_account_mail_previews` stores AES-256-GCM ciphertext, random IV and authentication tag. Versioned workspace-account/account/action/purpose associated data prevents swapping encrypted previews across contexts. Ciphertext, IV and tag are excluded by default. Previews expire with the proof; consuming/replacing the proof deletes the applicable encrypted preview. Key rotation prevents reading old ciphertext; already obtained bearer tokens still obey digest/expiry checks.

There is no HTTP preview listing/decryption endpoint, including for owners. A trusted operator can explicitly inspect a synthetic local fixture:

```sh
npm run saas:owner-mail-preview -- --uri mongodb://127.0.0.1:27017/saas_example --email owner@example.test --purpose password_reset
```

Use `email_verify` for the verification-flow preview. The command requires the local feature flag, development/test runtime, explicit loopback `saas_*` URI and configured key. It does not use dotenv, ambient `MONGODB_URI`, remote replica discovery or collection/index creation. It prints a current, unconsumed proof only to the explicitly invoked operator console; it does not consume it or send a message. Do not expose token output through shared logs, screenshots or URLs.

## API

All routes start with `/api/saas/account`, require JSON, no-store responses, browser-intent headers and allowed Origin when present. Unknown selectors/extra fields are rejected. The existing dedicated cookie/expected account ID protects authenticated requests.

| Method and path | Input | Authority |
|---|---|---|
| POST `/password-reset/request` | `email` | Public, rate limited, generic preview response |
| POST `/password-reset/confirm` | `token`, `newPassword`, `confirmed:true` | Single-use workspace reset proof |
| POST `/email-verification/request` | Empty object | Live workspace cookie and expected identity |
| POST `/email-verification/confirm` | `token`, `confirmed:true` | Single-use workspace preview proof |

Mail requests share five requests per 15 minutes per IP; proof attempts share ten per minute. Limits are in-process development controls; durable shared abuse protection remains pending. No global-role or legacy-login fallback applies to these endpoints. Account-security audit records contain neither tokens nor passwords.

Account recovery is independent of bakery subscription or suspension: it recovers the active workspace account without granting access to a suspended bakery. Inactive accounts cannot recover through self-service; platform support policy remains pending.

## Remaining delivery and rollout work

Real email sending, authenticated sending domains, provider acceptance/retry/bounce reconciliation, safe hosted link generation and verified-mail proof are not enabled. Production cookie/TLS and account recovery policy, shared durable throttling, browser/iPad validation, staging, backup/restore and a reviewed rollout remain necessary. No local preview may be migrated into a real verified-email claim.
