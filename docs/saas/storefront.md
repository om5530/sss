# Tenant profile and local menu preview

The owner-only Menu settings tab enables an anonymous, read-only preview at `/b/:slug`; older `/saas-menu/:slug` links redirect. All SaaS client routes are development-only and the API retains the local-database guard. This is not a production publishing or custom-domain rollout.

## Settings

`saas_storefronts` holds one profile per bakery, enforced by a unique bakery index. GET `/api/saas/bakeries/:bakeryId/storefront-settings` requires current owner membership. Missing settings return unpublished defaults and version 0, without inserting a document. PATCH accepts only profile fields plus expectedVersion. The settings change and audit metadata commit atomically; stale versions return 409.

Fields include brandTheme, brandMark, published, tagline, description, business contact phone/email, address/service area, display opening hours and showUnavailable. No credentials, payment keys or bank details are stored. Display hours do not enforce scheduling or checkout policies.

The UI reviews changes before saving and explicitly explains that enabled profiles expose these business contact details in the local preview. Drafts are owner-only. Switching bakery clears the form, and late responses cannot repopulate a different bakery's settings.

## Bakery branding

Owners can choose Warm gold, Soft rose or Fresh sage in Menu settings and set an optional 1–4-character text brand mark using A–Z/digits. Lowercase marks are normalized to uppercase; an empty mark uses the first initials of the bakery name. These are text marks, not uploaded logo files. The form shows an unsaved preview, and the confirmation dialog freezes the reviewed theme/mark/profile before the version-checked save.

The public menu uses the saved bakery theme for its background, header, cards and primary buttons. Branding is scoped to that menu; it does not alter another bakery or the legacy store. Controlled palette names select bundled CSS, never caller-supplied CSS, image URLs or HTML. Existing profiles without branding fields use Warm gold and inferred initials on read, without a backfill or write. Unknown stored theme values fall back safely.

The theme/mark are deliberately included in the public profile whitelist. Unpublished profiles remain owner-only. Changing the bakery clears unsaved branding, and a late response or failed menu recheck cannot retain the previous bakery’s appearance. The header wraps for phone widths and uses a horizontal layout on larger screens. Real-browser/mobile/iPad visual validation remains pending; compilation and state/API tests do not prove visual quality.

Owner-reviewed local logo and product-image uploads are now documented in `media.md`; a saved logo replaces the public header’s initials. Custom CSS/domains, production object storage and deliberate hosted tenant resolution remain release work.

## Anonymous boundary

GET `/api/saas/storefront/:slug` resolves the active bakery by its canonical slug and requires its published profile. Body/header IDs and bearer claims never select the tenant. Unknown, unpublished and suspended bakeries return the same 404. Responses are no-store.

The product query always includes the resolved bakery ID and archived:false. Unavailable/zero-stock products are omitted by default. showUnavailable can include their availability label, but never their stock quantity.

The public whitelist is bakery name/slug/currency/timezone, configured profile fields, and product ID/name/slug/category/description/dietary/selling price/availability. Owner identities, operational versions, stock counts, material costs, recipe mappings and order/finance data are excluded. Cursor pagination remains tenant scoped.

The preview uses Angular text interpolation rather than injecting HTML. Previous menu data is cleared on slug changes and failed/disabled rechecks. The development preview hides the legacy store navigation/footer so a different bakery is not presented under The Golden Batch's storefront shell. Production navigation behavior is unchanged.

## Remaining rollout work

Local pickup checkout and bakery-specific customer sessions are now available (`customers.md`, `pickup.md`). Production hosting, custom domains/host resolution, verified identity/recovery, live subscriptions, production media storage and provider payment routing remain later work. No production profile or catalogue was published. Browser visual QA remains pending; API boundaries, asynchronous state and compilation have separate tests.


## Local pickup ordering

An additional `acceptCustomerOrders` setting defaults to false and is reviewed with publication settings. A published profile exposes only the public `orderingEnabled` capability flag. Accounts, sessions, checkout and order history are documented in `customers.md`; no customer identity or history is included in the anonymous menu response.

Owners can configure `pickupReservationMinutes` (integer 5–1,440, default 30). Checkout binds the quoted duration before saving an unpaid pickup reservation; later setting edits do not alter saved deadlines. Cancellation and request-driven expiry are documented in `reservations.md`.

Canonical local links and the offline preflight are documented in `routing-and-rehearsal.md`; the connected synthetic API journey is in `rehearsal-results.md`. Neither authorizes hosted staging or production.
