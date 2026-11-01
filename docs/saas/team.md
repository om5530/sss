# Staff invitations and bakery-scoped team access

Owners can create an invite in the local workspace's Team tab. A signed-in recipient pastes the code into Join a bakery, reviews the bakery name/access, and explicitly accepts. The application does not send invitations, messages or emails. No actual staff account or production membership was changed during implementation.

## Capability and authorization

Codes contain 32 cryptographically random bytes encoded as 64 hexadecimal characters. Only a SHA-256 hash is stored in `saas_invitations`; raw codes are returned once to their issuing owner. Codes are submitted in authenticated JSON POST bodies, never URL paths or query parameters. Owner lists omit codes and hashes. The UI hides a generated code when the page is hidden, the bakery changes or the component is destroyed.

An unused code permits staff access only. The recipient cannot supply a bakery ID, user ID or role. The server resolves the target from the opaque hash, requires an active bakery and valid unrevoked/unexpired invitation, and grants membership to the authenticated account. Inspect/accept attempts are limited per account. Existing active members can open their existing workspace without consuming an unused invitation. A consumed code cannot reactivate a revoked membership or be used by another account.

Default expiry is 30 minutes; owners may choose up to 24 hours. Development safeguards limit a bakery to 20 outstanding active invitations and 50 active memberships including the owner. These are safety limits, not a billing tier or subscription implementation. Expired/used invitation metadata is retained for audit context; no raw code can be recovered from it.

## Scoped revocation and transactions

Owners can revoke an invitation or a staff membership after confirmation. Revoking a code prevents further use but does not remove staff who already joined. Removing staff affects this bakery only: the dedicated workspace account/session version and memberships elsewhere remain unchanged; legacy fixture users also retain their global sessions. Owner memberships cannot be removed or downgraded through the staff API. Ownership transfer and additional-owner invitations are separate future work.

Memberships have a permission version, independent of the internal authorization write counter. Sales activity does not invalidate the version shown to a team administrator. Revocations are version checked; reactivation requires a newly issued valid code and increments the membership version again.

Creation, acceptance and revocation include audit metadata in the same transaction. Failed audits roll back both membership and invitation state. Concurrent attempts to consume one code result in one new member. Active-team limits are checked under the same bakery transaction lock. Writers acquire bakery authorization before membership records to avoid owner/staff lock-order cycles.

## Privacy

The owner member list includes membership/account IDs, display name, role, active/account-active flags and permission version. It resolves display names only for members of that bakery; no global search or email/phone directory is exposed. Staff cannot list invitations, list members, grant roles, inspect costs, change menu settings or view private financial reports.

## Routes

All routes retain the development/local-database guard. Signed-in invite recipients use POST `/api/saas/invitations/inspect` and `/accept` with `{token}`. Owners use these paths under `/api/saas/bakeries/:bakeryId`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/members` | Bounded, paginated owner-only team list |
| POST | `/members/:memberId/revoke` | expectedVersion and confirmed:true; staff only |
| GET / POST | `/invitations` | Paginated metadata / create expiring staff code |
| POST | `/invitations/:invitationId/revoke` | expectedVersion and confirmed:true |

Before production, complete real authentication, platform quotas, operational monitoring, retention policy and staging/visual QA. The current prototype remains disabled on Vercel and cannot connect its new APIs to a cloud database.

Workspace account sign-in and membership identity domains are documented in `owner-accounts.md`. Emails never auto-link accounts or grant membership.
