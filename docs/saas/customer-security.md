# Local customer account security and recovery

This milestone adds confirmed password changes, token-based password reset, session revocation and a verification-flow preview. It remains behind the local SaaS/database guards. **No email is sent and real email ownership is not verified.** Production delivery/provider configuration is still required before onboarding external customers.

## Signed-in password change

The customer supplies the current password and matching new entries, reviews the sign-out consequence and explicitly confirms. The API requires the cookie and expected customer identity header; global/staff JWTs do not authorize the change. Current-password checking uses the existing scrypt implementation. The transaction rechecks both the live session and the previously checked password hash, so a concurrent reset cannot overwrite a newer password.

Changing a password increments the customer's session version, deletes every session for that account **at that bakery**, and invalidates pending account-action tokens/previews. It does not alter other customer accounts, other bakeries or staff sessions. The operation does not establish a replacement login. Existing pickup orders/history and durable order-retry records are preserved.

## Password reset and verification preview

Reset requests accept a normalized bakery-local email identifier. Eligible requests create a random 256-bit single-use token, SHA256 token digest and encrypted local mail preview. Responses use the same generic body for eligible, unknown, inactive and cooldown-limited accounts; they do not contain tokens, account IDs or mail-preview IDs. This is response-content protection, not a guarantee of constant-time network responses.

Reset tokens expire after 15 minutes; verification-preview tokens after 30 minutes. Explicit expiry, purpose, bakery, active account, session-version and consumption checks govern use. TTL indexes clean up expired data but never decide whether a token is valid. There is a 60-second per-account/purpose issuance cooldown. After that, a replacement token invalidates previous tokens for that purpose. Previously encrypted previews cannot revive consumed tokens.

Password reset needs the bearer token and a new password, without requiring a current cookie or receiving a new one. It performs the same scoped session revocation as a password change. Reset tokens cannot verify email and verification tokens cannot reset passwords. Concurrent reset attempts consume a token once; a failed audit rolls password, consumption, preview deletion and session revocation back together.

The local verification flow records **`emailPreviewConfirmedAt` only**. It leaves `emailVerified` unchanged/false. An operator reading a local preview has not demonstrated access to the recipient's real mailbox; the UI states that ownership remains unverified. Consuming a token never switches the browser to that token's account or signs it in. Possession of a proof for one customer does not alter a different currently signed-in account.

Account security remains usable under a restricted local subscription. Existing customers may sign in and recover access when the bakery's menu is unpublished or ordering is paused. New registrations still require a published, accepting store and capacity. Active bakery/customer state remains mandatory; suspended-bakery recovery requires a future platform support policy.

## Encrypted local delivery preview

Set `SAAS_LOCAL_MAIL_PREVIEW_KEY` to an explicitly generated 32-byte key encoded as 64 hex characters, in the **local** development environment only. Do not put the key in source, browser configuration, committed fixtures or URLs. The app does not generate or persist a replacement key automatically.

`saas_customer_actions` stores only the token digest. `saas_customer_mail_previews` stores AES-256-GCM ciphertext, a random 12-byte IV and authentication tag. Bakery/customer/action/purpose metadata is authenticated as associated data. Ciphertext/IV/tag are excluded from default model selection; there is no HTTP mail-preview listing/decryption endpoint, including for bakery owners. Pending previews expire alongside their action; successful use/password updates delete the applicable previews.

A missing/invalid preview key returns 503 for requests uniformly, without claiming delivery or looking up whether the email exists. Confirming a previously obtained valid token and changing a password do not depend on preview-key availability. Key rotation makes older encrypted previews unreadable; already obtained action tokens remain governed by their independent digest/expiry rules.

A trusted local operator can explicitly read a synthetic fixture preview from the command line:

```sh
npm run saas:mail-preview -- --uri mongodb://127.0.0.1:27017/saas_example --bakery-id OBJECT_ID --email alice@example.test --purpose password_reset
```

Use `email_verify` for a verification-flow preview. The local feature flag, development/test environment, explicit loopback `saas_*` URI and configured key are mandatory. The command does not use dotenv or `MONGODB_URI`, does not discover remote replica members, and disables collection/index creation. It selects a current, unconsumed action for the account/session version and prints the decrypted token only to the explicitly invoked operator console. It does not consume the token or send a message. Do not paste token output into public logs, URLs or screenshots.

The URI guard is shared with the local subscription operator command. Both refuse cloud SRV, credentials, non-loopback hosts, other database names and unsafe discovery options before connecting. No production connection/payload was used to test this workflow.

## API

All routes start with `/api/saas/storefront/:slug/customer`, require JSON and the existing browser-intent header/origin rules, and are no-store.

| Method and path | Input | Authority |
|---|---|---|
| POST `/password-reset/request` | `email` | Public, rate limited; generic local-preview response |
| POST `/password-reset/confirm` | `token`, `newPassword` | Purpose/bakery-bound bearer proof |
| POST `/email-verification/request` | Empty object | Live customer cookie plus expected identity header |
| POST `/email-verification/confirm` | `token` | Purpose/bakery-bound preview proof; never sets real ownership verified |
| POST `/password/change` | `currentPassword`, `newPassword`, `confirmed:true` | Live cookie, expected identity and current password |

Mail requests share an in-process five-per-15-minute IP limit across bakery slugs; confirmation/password-change requests share ten-per-minute. Existing sign-in limits remain separate. Passwords retain the existing 12–128 character/512-byte rules. Tokens are accepted only as body fields, never from query strings. Caller-supplied customer/tenant selectors and extra fields are rejected. Account security audit metadata includes neither passwords nor tokens.

## UI and recovery behavior

Account security controls appear below the pickup-account section, including when signed out or the menu is unavailable. Password/token fields clear before submission and on close, bakery/account changes and destruction. Requests have a 20-second client deadline. A timeout/uncertain password-update response advises trying sign-in before obtaining a new token; the app does not automatically repeat a credential change or preserve the secret in browser storage.

Account actions and checkout block each other while in flight. Successful credential updates refresh identity/history rather than retaining a revoked profile. Late responses cannot replace another bakery/account. Pending checkout recovery remains in its existing customer/bakery-scoped sessionStorage; security fields are never added to it.

## Remaining production work

A real email provider, authenticated sending domain, delivery/retry/bounce handling, safe link generation, verified-mail proof, durable throttling, recovery abuse review are not implemented by the preview. Separate workspace owner/staff recovery now has local proof flows (`owner-recovery.md`), also without real delivery. Production owner onboarding, real billing, production cookie/TLS policy, operational backups/monitoring and staging/browser validation remain launch work. Local previews must never be treated as email ownership evidence during migration.
