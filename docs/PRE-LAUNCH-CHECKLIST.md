# Pre-Launch Checklist — Sweet Savory Savor

Everything the operator must provide/configure to take the platform live, plus the improvement roadmap.
Env var names match `server/src/config/env.js`; client keys match `client/src/environments/environment.ts`.

> **Progress (2026-07-02):** all four launch blockers are **DONE** — B1 (Razorpay online payments), B2 (cash/pay-at-counter), B3 (contact form), B4 (production hardening). To take real online payments, supply the Razorpay keys (A1 #5); everything else works cash-only today.

> The app boots with **zero** config in mock/dev mode (mock OTP, mock payments, local Mongo fallback).
> In **production** (`NODE_ENV=production`) the server now refuses to start with insecure defaults (weak `JWT_SECRET`, missing `MONGODB_URI`, localhost `CLIENT_URL`, Stripe keys without a webhook secret) — but rotation of the leaked credential below is still on you.

---

## 🚨 Security — do this first

- [ ] **Rotate the MongoDB Atlas password.** `server/.env` contains a live Atlas credential. Even though `.env` is gitignored, treat it as leaked: Atlas → Database Access → Edit user → Edit Password, then update `MONGODB_URI`.
- [ ] **Replace `JWT_SECRET`.** The current value is a dev placeholder; anyone who knows it can forge **admin** sessions. Generate one:
  ```
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```

---

## A1. Required before launch

### 1. MongoDB URI → `server/.env` `MONGODB_URI`
- [ ] cloud.mongodb.com → rotate password (above) or create a fresh **M0 free cluster** (region: Mumbai)
- [ ] Database Access → add user (readWrite)
- [ ] Network Access → add your server's IP
- [ ] Clusters → Connect → Drivers → copy `mongodb+srv://...`, keep the `/bakery_cafe` db name
- URL-encode special characters in the password.

### 2. JWT secret → `server/.env` `JWT_SECRET`
- [ ] Run the node one-liner above and paste the output. Nothing to sign up for.
- Optional: `JWT_EXPIRES_IN` (default `7d`).

### 3. Google Client ID (enables "Sign in with Google")
Goes into **both** `server/.env` `GOOGLE_CLIENT_ID` **and** `client/src/environments/environment.ts` `googleClientId` (same value; no client secret is used).
- [ ] console.cloud.google.com → create/select project
- [ ] APIs & Services → **OAuth consent screen** → External → app name "Sweet Savory Savor", support email → save
- [ ] APIs & Services → **Credentials → + Create Credentials → OAuth client ID → Web application**
- [ ] Authorized JavaScript origins: `http://localhost:4200` **and** your production URL
- [ ] Copy the Client ID (ends in `.apps.googleusercontent.com`) into both places
- While blank, the Google button is disabled and `/auth/google` returns 400 — everything else still works.

### 4. Firebase project (real SMS OTP for phone login)
Client web config → `environment.ts` `firebase.{apiKey, authDomain, projectId, appId}`.
Server service account → `server/.env` `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (all three together).
- [ ] console.firebase.google.com → Add project
- [ ] Build → Authentication → Get started → Sign-in method → enable **Phone**
- [ ] Authentication → Settings → Authorized domains → add your production domain
- [ ] Project Overview → add **Web app (`</>`)** → copy `apiKey`, `authDomain`, `projectId`, `appId` → client `environment.ts`
- [ ] ⚙️ Project settings → **Service accounts → Generate new private key** → from the JSON map `project_id`, `client_email`, `private_key` → server `.env` (private key on ONE line with literal `\n`; `env.js` restores newlines)
- [ ] Upgrade to the **Blaze (pay-as-you-go) plan** — required for phone-auth SMS; per-SMS cost is small. Keep the JSON file private.
- Until configured, login falls back to **mock OTP** (code printed in the server console; also returned in the API response in dev only).

### 5. Razorpay keys (online payments — UPI / cards / netbanking)
→ `server/.env` `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. No client-side config needed — the key id is served by the API.
- [ ] razorpay.com → Sign up → complete KYC (PAN, bank account; works for sole proprietors)
- [ ] Dashboard → Account & Settings → **API keys** → Generate key → copy **Key Id** (`rzp_test_...` / `rzp_live_...`) and **Key Secret** (test mode first)
- [ ] Dashboard → Account & Settings → **Webhooks** → Add webhook → URL `https://<api-domain>/api/payments/razorpay-webhook` → events **payment.captured** + **payment.failed** → set a **webhook secret** and copy it
- [ ] Repeat with live keys after KYC approval
- With no keys set, checkout runs in **mock mode** (dev demo). Production **refuses to boot** if the key pair is incomplete or the webhook secret is missing — a paid-but-never-confirmed order is worse than no payments.
- *(Legacy: the Stripe backend integration is still present behind `STRIPE_*` env vars, but has no client-side card UI — Razorpay is the supported live rail.)*

### 6. Business numbers → `server/.env`
- [ ] `TAX_RATE` — confirm your GST rate (default `0.05`)
- [ ] `DELIVERY_FEE` — actual delivery fee (default `40`)
- [ ] `CURRENCY` — default `inr`

### 7. Domain + hosting
- [ ] Buy a domain (GoDaddy / Namecheap / Hostinger / etc.)
- [ ] Decide hosting: a **single VPS with a reverse proxy** keeps the client's relative `apiUrl: '/api'` working as-is; **separate hosts** need the absolute API URL filled into `client/src/environments/environment.prod.ts` (exists now — B4 ✅)
- [ ] Set `CLIENT_URL` to the deployed site URL (CORS + cookies break otherwise)
- [ ] Set `NODE_ENV=production` (enables secure cookies, hides dev OTP codes, quiets logging)

### 8. Admin account
- [ ] Decide which phone number / email is the admin, then run on the server:
  ```
  npm run make-admin -- <phone-or-email>
  ```
- There is no default admin and roles cannot be granted via the API (by design). `--revoke` removes the role.

---

## A2. Content needed from the client (Harshita)

- [ ] **Social media URLs** — footer Instagram / Facebook / WhatsApp icons currently point to `#`. WhatsApp needs the number in `wa.me/91XXXXXXXXXX` form.
- [ ] **Go-live confirmation of real details** — real address / hours / phone / email / brand name / about-page story are preserved in `REAL CLIENT DATA` comment blocks in `footer.html`, `contact.html`, `about.html`. Swap them in (delete the DUMMY blocks, uncomment the real ones) before launch.
- [ ] **Real product photography** — all ~30 product images are hot-linked Pexels/Unsplash stock URLs (`client/src/app/core/utils/food-image.ts`, mirrored in `server/src/utils/seed.js`). They can break at any time. Shoot the actual products (phone + daylight is fine) and pair with roadmap B5 (image upload).

---

## A3. Optional — only if the feature is wanted (each also needs code; see roadmap)

| Item | For | How to get it |
|------|-----|---------------|
| **Email service** (Resend recommended) | Order confirmation emails (B6) + emailing contact enquiries to the shop (they already land in the admin **Enquiries** page; the hook point is marked in `contact.controller.js`) | resend.com → sign up → Domains → add domain + DNS records → API Keys → create key. Alt: Gmail app password + SMTP. |
| **SMS provider** (MSG91 for India / Twilio) | Backend OTP without Firebase, order-status SMS | msg91.com → sign up → complete **DLT registration** (mandatory in India for transactional SMS) → authkey + template IDs. `deliverOtp()` in `otp.service.js` is a mock stub — real sending needs code either way. |
| **Cloudinary** | Product image upload (B5) | cloudinary.com → free account → Dashboard → cloud name, API key, API secret. |
| **Google Analytics 4** | Traffic insight (none exists today) | analytics.google.com → create property → Web stream → copy `G-XXXX` ID. |
| **Google Maps embed** | Map on the contact page (none exists today) | Google Maps → search the shop → Share → Embed a map → copy iframe URL. Free, no API key. |

---

## B. Improvement roadmap

### 🔴 Launch blockers

1. [x] ~~**Real payment capture on the client**~~ ✅ **DONE (2026-07-02, Razorpay)** — full Razorpay rail: server creates amount-pinned Razorpay orders, client opens Checkout.js (UPI/cards/netbanking), payment confirmed via HMAC-verified endpoint **and** a signature-verified idempotent webhook backstop; refunds route through Razorpay; a **Complete payment** retry lives on the customer's order page for abandoned/failed attempts. Provider precedence: Razorpay → Stripe (legacy, no UI) → mock (dev). Needs only the A1 #5 keys to go live.
2. [x] ~~**Cash on delivery / pay at counter**~~ ✅ **DONE (2026-07-02)** — checkout offers *Pay at counter / Pay at pickup / Cash on delivery* (cash is the default); cash orders skip the payment step; admin gets **Mark cash received** (audit-logged, refund-safe), a *collect cash* badge in the live queue, and an alert for completed-but-unrecorded cash.
3. [x] ~~**Wire the contact form**~~ ✅ **DONE (2026-07-02)** — `POST /api/contact` (validated, rate-limited 5/15min/IP) stores enquiries; new admin **Enquiries** page with new/read/closed triage. Email notification to the shop still needs the optional email service (A3) — enquiries land in the admin panel either way.
4. [x] ~~**Production hardening**~~ ✅ **DONE (2026-07-02)** — production refuses to boot on weak/dev `JWT_SECRET`, missing `MONGODB_URI`, localhost `CLIENT_URL`, or Stripe keys without a webhook secret; `environment.prod.ts` + `fileReplacements` added; rate limits on OTP verify / order create / payment endpoints / contact; `trust proxy` set in prod.

### 🟡 High value next

5. **Product image upload** (Cloudinary + admin product form) — replaces rot-prone stock hotlinks; the admin form already has a URL field noting "direct upload is on the roadmap". Pairs with real product photos (A2).
6. **Order notifications** — email (and/or WhatsApp/SMS) on placed / confirmed / ready / cancelled. Customers currently must poll the orders page; `statusHistory` is already tracked so the hooks are easy.
7. **Custom cake order flow** — the contact page invites "custom cake briefs" but there's no structured flow: brief form (occasion, size, reference photo, date needed) + admin review + advance payment. Big differentiator for a bakery.
8. **Storefront filters** — veg/egg-less, price, category chips. The backend `/products` endpoint already supports filtering; the menu UI only does client-side name search.
9. **Coupons / promo codes** — no discount concept exists in `pricing.service.js`; first-order and festival promos are standard for this segment.
10. **Inventory / stock tracking** — only a manual `available` toggle exists; daily bake counts with auto sold-out prevents overselling.

### 🟢 Growth & polish

11. **Reviews & ratings** — no social proof anywhere today.
12. **SEO** — SSR/hydration + meta/OG service + sitemap + LocalBusiness/Product schema. A pure SPA hurts Google ranking and WhatsApp link previews (crucial for a local bakery).
13. **PWA** — installable app, offline menu, web push (pairs with B6).
14. **Automated tests** — zero specs exist; `mongodb-memory-server` is already a devDependency. Priority targets: pricing, auth, order lifecycle, refunds.
15. **Analytics** — GA4 or Plausible; no tracking today.
16. **Account linking / recovery** — phone and Google identities are separate accounts; losing a phone number = losing order history.
17. **Small fixes** — footer year hardcoded to `2026` (`footer.ts`); map embed on the contact page; `STRIPE_PUBLISHABLE_KEY` is loaded server-side but never served to the client.

---

## Files of record

- Server env template: `server/.env.example` (safe, committed) → real values go in `server/.env` (never commit)
- All server env reads centralized in `server/src/config/env.js`
- Client config: `client/src/environments/environment.ts` (single file — no prod override exists yet)
- Real client content preserved in comments: `footer.html`, `contact.html`, `about.html`
- Admin bootstrap: `server/src/utils/make-admin.js` · Catalog seed (**destructive** — wipes and reinserts products): `server/src/utils/seed.js`
