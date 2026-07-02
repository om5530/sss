# Pre-Launch Checklist — Sweet Savory Savor

Everything the operator must provide/configure to take the platform live, plus the improvement roadmap.
Env var names match `server/src/config/env.js`; client keys match `client/src/environments/environment.ts`.

> **Progress (2026-07-03):** all four launch blockers **and the roadmap batch are DONE** — image upload (B5), order emails (B6), custom-cake flow (B7), menu filters (B8), coupons (B9), stock tracking (B10), reviews (B11), SEO-lite (B12), PWA (B13), automated tests (B14, 13 passing), analytics hook (B15). Deferred with reasons: full SSR (B12b) and account linking (B16).
>
> **🚀 LIVE (demo mode): <https://sss-omega-ashy.vercel.app>** — Vercel project `sss`, GitHub-connected: every push to `main` auto-deploys. Demo-mode caveats in force until the Part-A keys land: payments are **mock**, `EXPOSE_DEV_OTP=true` (anyone can log in as any phone — the boot guard forces its removal once live payment keys are set), **no Cloudinary** (admin photo upload errors on Vercel until the keys are added), and the Atlas password is still the leaked one — **rotate it**.

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

## A3. Optional keys — the features are BUILT; adding a key switches them on

| Item | Activates | How to get it |
|------|-----------|---------------|
| **Resend** → `RESEND_API_KEY`, `NOTIFY_FROM`, `SHOP_EMAIL` | All order/enquiry/cake emails (B6). Without a key they log to the server console. | resend.com → sign up → Domains → add domain + DNS records → API Keys → create key. `NOTIFY_FROM` must be a verified sender; `SHOP_EMAIL` is where shop alerts go. |
| **Cloudinary** → `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | CDN storage for uploaded photos (B5). **Required on Vercel** — the serverless filesystem is read-only, so the local-disk fallback only works in dev/VPS. | cloudinary.com → free account → Dashboard → cloud name, API key, API secret. |
| **GA4** → `gaMeasurementId` in `client/src/environments/environment*.ts` | Traffic analytics with SPA page views (B15). Blank = no tracking script at all. | analytics.google.com → create property → Web stream → copy `G-XXXX` ID. |
| **Google Maps embed** | Map card on the contact page — already written, commented next to the REAL CLIENT DATA block. | Nothing to get — uncomment at launch (keyless embed). |
| **SMS provider** (MSG91 / Twilio) | Backend OTP without Firebase, order-status SMS. *Still needs code* — `deliverOtp()` in `otp.service.js` is a mock stub. | msg91.com → sign up → **DLT registration** (mandatory in India) → authkey + template IDs. |

---

## B. Improvement roadmap

### 🔴 Launch blockers

1. [x] ~~**Real payment capture on the client**~~ ✅ **DONE (2026-07-02, Razorpay)** — full Razorpay rail: server creates amount-pinned Razorpay orders, client opens Checkout.js (UPI/cards/netbanking), payment confirmed via HMAC-verified endpoint **and** a signature-verified idempotent webhook backstop; refunds route through Razorpay; a **Complete payment** retry lives on the customer's order page for abandoned/failed attempts. Provider precedence: Razorpay → Stripe (legacy, no UI) → mock (dev). Needs only the A1 #5 keys to go live.
2. [x] ~~**Cash on delivery / pay at counter**~~ ✅ **DONE (2026-07-02)** — checkout offers *Pay at counter / Pay at pickup / Cash on delivery* (cash is the default); cash orders skip the payment step; admin gets **Mark cash received** (audit-logged, refund-safe), a *collect cash* badge in the live queue, and an alert for completed-but-unrecorded cash.
3. [x] ~~**Wire the contact form**~~ ✅ **DONE (2026-07-02)** — `POST /api/contact` (validated, rate-limited 5/15min/IP) stores enquiries; new admin **Enquiries** page with new/read/closed triage. Email notification to the shop still needs the optional email service (A3) — enquiries land in the admin panel either way.
4. [x] ~~**Production hardening**~~ ✅ **DONE (2026-07-02)** — production refuses to boot on weak/dev `JWT_SECRET`, missing `MONGODB_URI`, localhost `CLIENT_URL`, or Stripe keys without a webhook secret; `environment.prod.ts` + `fileReplacements` added; rate limits on OTP verify / order create / payment endpoints / contact; `trust proxy` set in prod.

### 🟡 High value next — ✅ ALL DONE (2026-07-03)

5. [x] **Product image upload** — "Upload photo" button in the admin product form (≤5 MB, JPEG/PNG/WebP). Stores to **Cloudinary when keys are set** (required on Vercel — the function filesystem is read-only), local `server/uploads` otherwise (dev).
6. [x] **Order notifications** — email via **Resend** (key in A3; logs to console without it): order placed (customer + shop), payment confirmed, ready/completed/cancelled, refunds, new enquiries, new cake requests. All user input HTML-escaped.
7. [x] **Custom cake order flow** — public `/custom-cakes` brief (occasion, servings, flavour, date, reference-photo upload) + admin **Cake requests** page with quote-and-status triage (new → quoted → accepted/declined → closed) + shop email alert.
8. [x] **Storefront filters** — dietary chips (Everything / Veg / Contains egg / Non-veg) on the menu, combined with live search.
9. [x] **Coupons** — percent/flat codes with min-subtotal, max-discount, expiry and usage limits; admin **Coupons** page; coupon box in checkout; discount rows everywhere incl. emails. Slots are reserved atomically at order time and returned on cancellation (refunds keep the redemption). Note: an abandoned unpaid order holds its slot until staff cancel it.
10. [x] **Stock tracking** — optional per-product daily count (blank = untracked): atomic claim on order, oversell → friendly 409, auto-hide at 0, cancel restocks exactly what was claimed, "Only X left" chips on cards.

### 🟢 Growth & polish — ✅ DONE except two deliberate deferrals

11. [x] **Reviews & ratings** — verified-purchase only (completed order containing the item), one per customer per product (editable), stars on cards + product page, denormalised `ratingAvg/ratingCount`.
12. [x] **SEO-lite** — per-route meta descriptions + OpenGraph/canonical (product pages use the real photo), Bakery JSON-LD, `robots.txt`, `sitemap.xml`. ⏸️ **Full SSR/hydration deferred**: it changes the Vercel build (Angular SSR adapter) and is best done as its own project once traffic justifies it — the meta/OG layer already fixes link previews.
13. [x] **PWA** — installable, offline app shell, cached menu (`freshness`, 1h), brand icons in `client/public/icons/` rendered from the real logo (192/512 + dedicated maskable 512 + apple-touch 180 on cream), `favicon.ico` rebuilt to match.
14. [x] **Automated tests** — `npm test` in `server/`: 13 integration+unit tests over pricing, coupons (incl. reservation/release), stock (incl. phantom-restock and hidden-product guards), lifecycle, cash-settle guards, reviews gate, contact/cake validation, Razorpay signatures.
15. [x] **Analytics** — GA4 wired behind `gaMeasurementId` in the environment files (blank = fully disabled); SPA page views tracked on navigation.
16. ⏸️ **Account linking / recovery — DEFERRED**: merging phone+Google identities needs product decisions (what proves ownership? what happens to two order histories?) — bring it back post-launch with real user feedback.
17. [x] **Small fixes** — footer year now dynamic; map embed ready (commented with the REAL CLIENT DATA block on the contact page); `STRIPE_PUBLISHABLE_KEY` note is moot now that Razorpay is the live rail.

---

## Files of record

- Server env template: `server/.env.example` (safe, committed) → real values go in `server/.env` (never commit)
- All server env reads centralized in `server/src/config/env.js`
- Client config: `client/src/environments/environment.ts` (single file — no prod override exists yet)
- Real client content preserved in comments: `footer.html`, `contact.html`, `about.html`
- Admin bootstrap: `server/src/utils/make-admin.js` · Catalog seed (**destructive** — wipes and reinserts products): `server/src/utils/seed.js`
