# API Reference — Bakery & Café Platform

Base URL: `http://localhost:4000/api`

`GET /auth/phone-config` returns `mode` (`firebase`, development-only `mock`, or `disabled`) and only public Firebase web configuration. `POST /auth/firebase-phone` exchanges a signed Firebase ID token for an app session, requiring recent phone authentication and a non-revoked token. Mock `/auth/otp/request` and `/auth/otp/verify` are disabled in production and whenever Firebase is configured. See [phone OTP setup](PHONE-OTP-SETUP.md).

`GET /admin/messages/unread-count` returns `{ success: true, newCount }` for enquiries with status `new`. This admin-only endpoint is not cacheable.

`GET /admin/reports/products` accepts `rankBy=quantity` to rank the top ten products by units sold; omitted/other values use revenue. Ranking occurs before limiting results. Category labels resolve through current managed categories, with legacy fallback; sales amounts retain the existing stored-order calculations.

### Store settings

`GET /admin/settings` and `PATCH /admin/settings` require an active admin session. PATCH accepts any subset of `taxRate` (number 0–1), `deliveryFee` (number 0–100000, up to two decimal places), `currency` (`inr` only), `opensAt`, `closesAt` (HH:MM, 00:00–24:00), `contactAddress` (up to 240 characters), `contactPhone` (up to 40 characters) and `contactEmail` (valid email or empty). Responses contain `{ success, settings }`. Mutations record a `settings.update` audit entry. Equal opening/closing times mean closed; overnight windows are supported in IST.

`GET /shop` returns `{ success, shop }` with saved hours, `openNow`, `timezone`, and the three contact fields. It is not cacheable. Pricing and hours initialize from environment values on the first connected read; saved settings then take precedence. Contact fields initially remain blank. Pricing changes apply to subsequent quotes and new orders; stored orders are not repriced. Notification email configuration remains in environment variables.

All responses are JSON and include a `success` boolean. Errors use the shape:

```json
{ "success": false, "message": "Human readable message", "details": [ { "field": "phone", "message": "Enter a valid phone number" } ] }
```

Authentication uses a JWT returned on login. It is set as an `httpOnly` cookie **and** returned in the response body as `token`. Send it on protected routes via either the cookie (automatic) or `Authorization: Bearer <token>`.

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Service + DB + integrations status. |

---

## Auth

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/auth/google` | — | `{ idToken }` | Verify a Google ID token, create/match the user, return a session. |
| POST | `/auth/otp/request` | — | `{ phone }` | Send an OTP (rate-limited 5 / 10 min). In mock mode the code is returned as `devCode`. |
| POST | `/auth/otp/verify` | — | `{ phone, code }` | Verify the OTP, create/match the user, return a session. |
| GET | `/auth/me` | ✅ | — | Current user profile. |
| PATCH | `/auth/me` | ✅ | `{ name?, email? }` | Update profile. |
| POST | `/auth/logout` | ✅ | — | Revoke all currently issued account sessions and clear the cookie. Old bearer tokens stop authenticating. |
| POST | `/auth/addresses` | ✅ | `{ fullAddress, area, city, pincode, landmark?, label?, isDefault? }` | Add an address; requires a valid 6-digit Indian pincode. |
| PATCH | `/auth/addresses/:addressId` | ✅ | partial address | Update an address. |
| DELETE | `/auth/addresses/:addressId` | ✅ | — | Delete an address. |

Profile responses include `identityReadOnly`. When true, Google owns the name/email and attempts to change them return `400`. Other profiles validate name/email; an empty email clears the optional field. Address patches validate each supplied field and cannot overwrite address IDs. Deleting the default address assigns the first remaining address as default.

---

## Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/products` | — | List products. Query: `group`, `category`, `q`, `available`, `featured`. |
| GET | `/products/menu` | — | Products grouped as `{ group: { category: [...] } }`. |
| GET | `/products/categories` | — | Distinct categories with counts. |
| GET | `/products/:slug` | — | A single product by slug. |

---

## Cart

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/cart/price` | — | `{ items: [{ productId, quantity }], orderType? }` | Server-side re-pricing (subtotal, tax, delivery, total). Never trusts client prices. |

---

## Orders

### Staff-entered orders and event sales

Admin console: **Orders → Add order** records phone orders, walk-ins and event/stall sales. **Event sales** shows all-time event totals, payment splits and products sold. Customer details are optional for counter sales; phone orders and delivery require a name and phone. Staff may schedule preparation outside website checkout's opening-hour and two-day limits. Completed counter sales skip the kitchen queue. Orders needing preparation start as `confirmed`; today's scheduled orders and ASAP orders appear in the prep sheet. Product stock is claimed at save time and released on cancellation.

All following endpoints require an active admin session and return `Cache-Control: no-store`:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/orders/quote` | Quote `{ items: [{ productId, quantity }], orderType }` at current store prices, tax and delivery fee. |
| POST | `/admin/orders` | Create a staff-entered order with the reviewed quote. |
| POST | `/admin/orders/:id/settle-manual` | Record full payment received for an unpaid staff order. |
| GET | `/admin/orders/:id/upi-qr` | Get an unpaid staff UPI order's amount-filled personal UPI request. |
| GET | `/admin/reports/events` | Event totals and product subtotals. Optional exact, case-insensitive `eventName` filter. |

Creation accepts `requestKey` (UUID v4), `expectedQuote: { items, pricing }`, `items`, `orderType` (`dining`, `takeaway`, `delivery`), `source` (`phone`, `walk-in`, `event`), optional `eventName` (required for event sales), `customer: { name, phone }`, `paymentMethod` (`upi` by default, or `cash`), `paymentStatus` (`pending`, `paid`), `orderStatus` (`confirmed`, `completed`), optional `fulfilAt`, `tableNumber`, `delivery` and `notes`. A scheduled time must be in the future and cannot accompany a completed sale. A changed quote returns `409 PRICE_CHANGED` before stock changes. Retries with the same request key and payload return the existing order; changed payloads under an already-used key return `409`.

UPI creation accepts optional `upiRecipientId` (`harshita`, `omkar`, `aarchita`) and always starts unpaid, even if the submitted payment status is paid. Store settings expose `upiRecipients: [{ id, name, upiId, payeeName }]` and `defaultUpiRecipientId`, initially Harshita. PATCH settings requires all three unique recipients when replacing the list; an account may have a blank UPI ID but the default must be configured. Account details are copied into each saved order, so later settings changes do not redirect existing requests. The QR endpoint returns `{ success, payment: { recipientName, upiId, payeeName, amount, currency, orderNumber, uri } }` with the stored order total, including tax and delivery. Paid/cancelled orders cannot request another QR. QR generation does not verify receipt or mark an order paid; staff verifies the receiving account before settlement.

`GET /admin/orders` also accepts `source` and `eventName`; search includes manual customer names/phones and event names. Legacy orders without a source are treated as website orders. Staff orders use `Payment.provider = manual`; Manual payments here are staff records of payments collected separately. Settlement and refunds do not charge or transfer money. Staff must return money before recording a manual refund. Sales totals and units exclude unpaid, cancelled and refunded orders; unpaid totals exclude cancelled/refunded orders. Product subtotals exclude tax and delivery fees. Staff orders cannot be fetched or paid through public guest-order endpoints.

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/orders` | Delivery only | `{ items, expectedQuote, orderType, paymentMethod?, couponCode?, fulfilAt?, dining?/takeaway?/delivery? }` | Create an order only when fresh server prices match the reviewed summary. |
| GET | `/orders` | ✅ | — | The current user's orders, newest first. |
| GET | `/orders/:id` | ✅ | — | A single order (owner or admin only). |
| PATCH | `/orders/:id/status` | ✅ admin | `{ status, note? }` | Advance order status. |

Order statuses: `placed → confirmed → preparing → ready → completed` (`cancelled` is terminal).

Before creating an order, call `/cart/price` with the current items, order type and optional coupon code. Display its `items` and `pricing`, then submit those unchanged as `expectedQuote: { items, pricing }`. A missing or malformed quote returns `400`. Changed line prices, quantities or pricing breakdown return `409` with `{ success: false, code: 'PRICE_CHANGED', message, quote: { items, pricing } }`. Display the new quote and require explicit customer confirmation before retrying. No stock or coupon slots are reserved on a quote mismatch. Submitted amounts are only compared; the server always computes the stored amount itself.

Dine-in requires a name; takeaway requires a name and valid phone; delivery requires full address, area, city and a valid 6-digit Indian pincode. Guest dine-in/takeaway remains supported.

---

## Payments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/payments/:orderId/intent` | ✅ | Create a Stripe PaymentIntent for the order (amount taken from the stored order). Returns `clientSecret` and `mock` flag. |
| POST | `/payments/:orderId/confirm-mock` | ✅ | **Mock mode only.** Marks the order paid/confirmed for local demos without Stripe keys. |
| GET | `/payments/:orderId` | ✅ | Payment record for an order. |
| POST | `/payments/webhook` | Stripe sig | Stripe webhook (raw body). Verified + idempotent; confirms the order on `payment_intent.succeeded`. |

---

## Order type payloads

```jsonc
// Dining
{ "orderType": "dining", "dining": { "tableNumber": "12", "customerName": "Asha" } }

// Takeaway
{ "orderType": "takeaway", "takeaway": { "customerName": "Asha", "phone": "+919876543210" } }

// Home delivery
{ "orderType": "delivery", "delivery": { "fullAddress": "12 Baker St", "area": "MG Road", "city": "Pune", "pincode": "411001", "landmark": "Near park" } }
```
# Admin security, categories and notification delivery (2026-09-09)

Customer search uses `POST /admin/customers/search` with JSON `{ "q": "search text", "page": 1, "limit": 20 }`. All fields are optional; search is limited to 200 characters and pagination must use positive integers. Responses remain admin-only, paginated and `Cache-Control: no-store`. `GET /admin/customers` remains available for unfiltered listing/pagination, but URL search parameters are rejected. Deploy client and server together; older admin pages must refresh.

Application access logs omit query strings. Customer-search server failures log a request ID and generic diagnostic without raw database errors or search values. This does not remove historical logs or control external proxy/database logging; external request-body capture must remain disabled for this endpoint.

All admin routes require an active admin account/session. Admin idle timeout defaults to 30 minutes (`ADMIN_IDLE_MINUTES`). `GET /auth/me` includes `idleExpiresAt` for admins and does not renew activity. `POST /auth/activity` renews a still-active admin session; expired sessions return 401 and require sign-in.

- `PATCH /admin/customers/:id/status`: `{ active: boolean, reason?: string }`. Deactivation requires a nonblank reason (max 500 characters). Customer accounts only; preserves orders and revokes old tokens on both deactivation and reactivation. Inactive sign-in/authenticated access returns 403.
- `GET /admin/categories`: categories with product counts, group and display order; imports existing product category strings into stable references.
- `POST /admin/categories`: `{ name, group }` (`bakery` or `savoury`). Names are unique within a group, case-insensitively.
- `PATCH /admin/categories/:id`: `{ name }`; retains group and product references.
- `PATCH /admin/categories/order`: `{ group, ids }`; requires every active category ID in that group exactly once, in desired order.
- `DELETE /admin/categories/:id`: rejects nonempty categories with 409, including archived products. Reassign products through product PATCH first.
- Product creation and category/group changes must use an existing managed category. Product responses include `categoryId`, current category name and `categoryOrder`.

Paths above are relative to `/api`. Responses include `X-Request-ID`; error bodies include `requestId`. Unexpected production errors use a generic message; server logs retain the matching ID.
