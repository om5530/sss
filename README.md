# Sweet Savory Savor — Bakery & Café Online Ordering Platform

A full-stack **MEAN** (MongoDB · Express · Angular · Node.js) application for a modern bakery
and café: browse a kiosk-style menu, build a cart, sign in, choose dine-in / takeaway / delivery,
pay, and track orders — with a premium, animated storefront (Three.js + scroll reveals).

Built from the product spec in [USER_STORIES.md](USER_STORIES.md).

---

## ✨ Features

| Area | What's included |
|------|-----------------|
| **Storefront** | "Midnight Patisserie" design system (see [docs/DESIGN.md](docs/DESIGN.md)): cinematic 12-section homepage — video hero with a lazy **Three.js** ambient particle layer, GSAP ScrollTrigger + **Lenis** smooth scrolling, masked-headline entrances, hover-driven category showcase, stats counters, testimonials, gallery marquees, FAQ and CTA finale — all built on real photography. |
| **Menu** | Kiosk-style menu grouped by category, live **search**, sticky category nav, veg/non-veg/egg tags, availability. |
| **Cart** | Add / remove / change quantity, persisted to `localStorage`, **server-side re-pricing** (subtotal, tax, delivery). |
| **Auth** | **Phone + OTP** (works out of the box in mock mode) and **Google Sign-In** (optional). JWT session via cookie + bearer token. |
| **Checkout** | Dine-in / Takeaway / Delivery with conditional fields, saved addresses, order summary. |
| **Payments** | **Stripe** PaymentIntents with a **mock mode** so the flow works with no keys; verified, idempotent **webhook**. |
| **Orders** | Order confirmation, status tracker (`placed → confirmed → preparing → ready → completed`), order history, timeline. |
| **Profile** | Edit profile, manage saved addresses, sign out. |
| **Quality** | Zoneless Angular + signals, lazy-loaded routes (three.js/GSAP/Lenis all lazy — ~90 kB initial transfer), responsive, accessible, `prefers-reduced-motion` aware end-to-end, friendly error handling, rate-limited OTP, ownership checks on orders. |

---

## 🗂️ Project structure

```
sss/
├── README.md                 ← you are here
├── USER_STORIES.md           ← product backlog (epics + stories)
├── package.json              ← root convenience scripts
├── docs/
│   └── API.md                ← REST API reference
├── server/                   ← Node.js + Express + Mongoose API
│   ├── .env / .env.example
│   └── src/
│       ├── server.js  app.js
│       ├── config/    (env, db)
│       ├── models/    (User, Product, Order, Payment, Otp)
│       ├── middleware/(auth, validate, errorHandler, dbReady)
│       ├── services/  (token, otp, google, stripe, pricing)
│       ├── controllers/  routes/
│       └── utils/     (seed.js — product catalogue)
└── client/                   ← Angular 21 app (standalone, signals, zoneless)
    └── src/app/
        ├── core/      (models, services, interceptors, guards)
        ├── shared/    (navbar, footer, product-card, status-tracker, toast, 3D, directives)
        └── pages/     (home, menu, product-detail, cart, login, checkout,
                        order-success, orders, order-detail, profile, about, contact, 404)
```

---

## 🚀 Quick start

### Prerequisites
- **Node.js 20+** (built and tested on Node 24)
- **MongoDB** — a local `mongod`, **MongoDB Atlas** (free), or Docker (see below)

### 1. Install everything
```bash
npm run install:all
```
> Or individually: `npm install --prefix server` and `npm install --prefix client`.

### 2. Point the API at a database
The server reads `server/.env` (already created with safe dev defaults). Set `MONGODB_URI`:

- **Local MongoDB:** keep the default `mongodb://127.0.0.1:27017/bakery_cafe`
- **Atlas:** paste your connection string, e.g.
  `mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/bakery_cafe`
- **Docker:** `docker run -d -p 27017:27017 --name bakery-mongo mongo:7`

### 3. Seed the product catalogue
```bash
npm run seed          # inserts ~30 products across 10 categories
```

### 4. Run it (two terminals)
```bash
npm run dev:server    # API → http://localhost:4000
npm run dev:client    # App → http://localhost:4200
```
Open **http://localhost:4200**. The Angular dev server proxies `/api` → `:4000`.

---

## 🔐 Auth, payments & integrations

Everything works **out of the box in mock mode** — no third-party accounts required.

### Phone + OTP (default)
With `OTP_PROVIDER=mock`, the OTP is printed to the server console **and** returned in the API
response so the login screen shows it in a "Dev mode" hint. To send real SMS, implement a provider
in [server/src/services/otp.service.js](server/src/services/otp.service.js) (Twilio, MSG91, …) and
set `OTP_PROVIDER` accordingly.

### Google Sign-In (optional)
1. Create an OAuth **Web Client ID** in the Google Cloud console.
2. Set `GOOGLE_CLIENT_ID` in `server/.env` **and** `googleClientId` in
   [client/src/environments/environment.ts](client/src/environments/environment.ts).
3. The Google button renders automatically; otherwise the OTP flow is used.

### Stripe payments (optional)
Without keys, the platform runs in **mock mode**: an order is placed and confirmed via
`/payments/:id/confirm-mock` so you can see the full flow. To go live:
1. Set `STRIPE_SECRET_KEY` (and `STRIPE_PUBLISHABLE_KEY`) in `server/.env`.
2. For confirmation regardless of the browser, run the webhook:
   `stripe listen --forward-to localhost:4000/api/payments/webhook` and set `STRIPE_WEBHOOK_SECRET`.
3. Integrate Stripe Elements on the client checkout (a clearly-marked hand-off point exists in
   [checkout.ts](client/src/app/pages/checkout/checkout.ts)).

---

## 🧑‍🍳 Admin console

A full staff console lives at **`/admin`** (lazy-loaded — storefront visitors never download it):
dashboard, live order queue with sound alerts and one-tap status moves, order management
(filter/search, cancel with reason, refunds), product CRUD with availability/featured toggles and
soft-archive, customers, payments reconciliation, sales & product reports (CSV export), and an
append-only audit trail of every staff action.

Roles are only ever granted server-side. Sign in once with the account you want to promote, then:

```bash
cd server
npm run make-admin -- <phone-or-email>     # e.g. npm run make-admin -- +919921279128
npm run make-admin -- <phone-or-email> --revoke   # demote back to customer
```

An **Admin** link appears in the navbar for admin accounts. Every `/api/admin/*` endpoint is
enforced with `requireRole('admin')` on the server and responds with `Cache-Control: no-store`.
The backlog behind it is documented in [ADMIN_USER_STORIES.md](ADMIN_USER_STORIES.md).

---

## ⚙️ Configuration (`server/.env`)

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `4000` | API port |
| `CLIENT_URL` | `http://localhost:4200` | CORS origin |
| `MONGODB_URI` | local | Mongo connection string |
| `JWT_SECRET` | dev value | **Change in production** |
| `JWT_EXPIRES_IN` | `7d` | Session lifetime |
| `GOOGLE_CLIENT_ID` | empty | Enables Google login |
| `OTP_PROVIDER` | `mock` | `mock` returns the code in dev |
| `OTP_TTL_SECONDS` | `300` | OTP validity |
| `OTP_RESEND_COOLDOWN` | `30` | Resend throttle |
| `STRIPE_SECRET_KEY` | empty | Empty ⇒ mock payments |
| `STRIPE_WEBHOOK_SECRET` | empty | For webhook verification |
| `TAX_RATE` | `0.05` | Applied to subtotal |
| `DELIVERY_FEE` | `40` | Added for delivery orders |
| `CURRENCY` | `inr` | Stripe currency |

---

## 📡 API

Full reference in [docs/API.md](docs/API.md). Health check: `GET http://localhost:4000/api/health`.

Highlights:
- `GET /api/products` · `GET /api/products/menu` · `GET /api/products/:slug`
- `POST /api/auth/otp/request` · `POST /api/auth/otp/verify` · `POST /api/auth/google`
- `POST /api/cart/price` (server-side totals)
- `POST /api/orders` · `GET /api/orders` · `GET /api/orders/:id`
- `POST /api/payments/:orderId/intent` · `POST /api/payments/webhook`
- `GET /api/admin/dashboard` · `GET /api/admin/orders` · `POST /api/admin/orders/:id/refund` ·
  `POST /api/admin/products` · `GET /api/admin/reports/sales` · `GET /api/admin/audit` (admin-only)

---

## 📜 Root scripts

| Script | Action |
|--------|--------|
| `npm run install:all` | Install server + client deps |
| `npm run seed` | Seed the product catalogue |
| `npm run dev:server` | Start API with nodemon |
| `npm run dev:client` | Start Angular dev server |
| `npm run build:client` | Production build of the client |

---

## 🛡️ Security notes

- Prices and order totals are **always recomputed on the server** — client values are never trusted.
- Orders enforce **ownership** (a user can only read their own orders; status changes are admin-only).
- OTP requests are **rate-limited** and codes **expire**; payment amounts come from the stored order.
- Secrets live in `.env` (git-ignored). Card details never touch the server (Stripe handles them).

---

## ☁️ Deployment

The repo deploys to **Vercel** as a single project — static Angular client + the Express
API as a serverless function under `/api` (MongoDB Atlas + Cloudinary for storage).
Step-by-step guide, required env vars and caveats: [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md).
Before going live, walk [docs/PRE-LAUNCH-CHECKLIST.md](docs/PRE-LAUNCH-CHECKLIST.md).

---

## 🛣️ Roadmap

Admin dashboard (catalogue, orders, reports), AI recommendations, loyalty points, coupons,
subscriptions, WhatsApp notifications, kitchen display, delivery-partner integration.
See "Future Enhancements" in [USER_STORIES.md](USER_STORIES.md).

---

## 📄 License

MIT — built as a full-stack portfolio reference for the MEAN stack.
