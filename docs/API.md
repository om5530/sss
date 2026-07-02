# API Reference — Bakery & Café Platform

Base URL: `http://localhost:4000/api`

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
| POST | `/auth/logout` | ✅ | — | Clear the session cookie. |
| POST | `/auth/addresses` | ✅ | `{ fullAddress, area?, city?, pincode?, landmark?, isDefault? }` | Add an address. |
| PATCH | `/auth/addresses/:addressId` | ✅ | partial address | Update an address. |
| DELETE | `/auth/addresses/:addressId` | ✅ | — | Delete an address. |

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

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/orders` | ✅ | `{ items, orderType, dining?/takeaway?/delivery? }` | Create an order; the server re-prices the cart. |
| GET | `/orders` | ✅ | — | The current user's orders, newest first. |
| GET | `/orders/:id` | ✅ | — | A single order (owner or admin only). |
| PATCH | `/orders/:id/status` | ✅ admin | `{ status, note? }` | Advance order status. |

Order statuses: `placed → confirmed → preparing → ready → completed` (`cancelled` is terminal).

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
