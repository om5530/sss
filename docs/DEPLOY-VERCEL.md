# Deploying to Vercel

One Vercel project serves the whole platform:

- The **Angular client** is built at deploy time and served as static files.
- The **Express API** runs as a single serverless function ([api/index.js](../api/index.js));
  every `/api/*` request is rewritten to it (see [vercel.json](../vercel.json)).
- Client and API share one origin, so `apiUrl: '/api'` in
  [environment.prod.ts](../client/src/environments/environment.prod.ts) works unchanged and
  auth cookies are first-party.

MongoDB itself does not run on Vercel — use **MongoDB Atlas** (free M0 tier is fine).

---

## 1. Prerequisites

| Service | Why | Notes |
|---|---|---|
| [MongoDB Atlas](https://www.mongodb.com/atlas) | Database | Create a cluster, a DB user, and allow access from `0.0.0.0/0` (Vercel functions have no fixed IP). |
| [Cloudinary](https://cloudinary.com) | Image hosting | **Required on Vercel.** The function filesystem is read-only and wiped between invocations, so local-disk uploads (`/api/uploads`) cannot work. With Cloudinary keys set, [upload.service.js](../server/src/services/upload.service.js) switches automatically. |
| Razorpay | Payments | Optional at first — with no keys the API runs in MOCK payment mode. |

## 2. Import the repo

1. [vercel.com/new](https://vercel.com/new) → import `om5530/sss`.
2. Leave **Root Directory** as the repo root. `vercel.json` supplies the install command,
   build command (`npm run build:client`) and output directory — don't override them.
3. Add the environment variables below, then **Deploy**.

## 3. Environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production).
The API **refuses to serve** in production until the required ones are set
(see [assertProdConfig.js](../server/src/config/assertProdConfig.js)).

| Variable | Required | Value |
|---|---|---|
| `MONGODB_URI` | ✅ | Atlas string, e.g. `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/bakery_cafe` |
| `JWT_SECRET` | ✅ | Long random string (32+ chars): `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CLIENT_URL` | ✅ | The deployed site origin, e.g. `https://sss.vercel.app` (no trailing slash). Update it if you attach a custom domain. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | ✅ (for image uploads) | From the Cloudinary dashboard. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | For live payments | Dashboard → Account & Settings → API keys. Must be set together. |
| `RAZORPAY_WEBHOOK_SECRET` | With Razorpay keys | Created with the webhook (step 4). The boot guard requires it once keys are set. |
| `GOOGLE_CLIENT_ID` | Optional | Enables Google sign-in (also set it in `environment.prod.ts` and redeploy). |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Optional | Real SMS OTP. Paste the key on one line with literal `\n`, quoted. |
| `RESEND_API_KEY` / `NOTIFY_FROM` / `SHOP_EMAIL` | Optional | Order/enquiry email alerts. |
| `TAX_RATE` / `DELIVERY_FEE` / `CURRENCY` | Optional | Defaults: `0.05` / `40` / `inr`. |

`NODE_ENV=production` is set by Vercel automatically — don't add it.

## 4. Razorpay webhook

After the first deploy: Razorpay Dashboard → Webhooks → Add:

- URL: `https://<your-app>.vercel.app/api/payments/razorpay-webhook`
- Events: `payment.captured`, `payment.failed`
- Copy the webhook secret into `RAZORPAY_WEBHOOK_SECRET` and redeploy.

## 5. Seed the catalogue & create the admin

Run locally against Atlas (PowerShell):

```powershell
cd server
$env:MONGODB_URI = "mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/bakery_cafe"
npm run seed
npm run make-admin
```

## 6. Verify

- `https://<your-app>.vercel.app/api/health` → `{ "db": "connected", ... }`
- Site loads, menu shows seeded products, admin login works.
- Place a test order end-to-end (COD first, then Razorpay test mode).

---

## Platform caveats

- **Request body limit ~4.5 MB** on Vercel functions — very large product/cake photos
  will be rejected before reaching the API.
- **Rate limiting is in-memory** per function instance, so limits are per-instance and
  reset on cold starts — softer than on a single long-running server, but not off.
- **Mock OTP / mock payments** print codes to function logs (Vercel → Deployments → Logs)
  when Firebase/Razorpay are not configured.
- `server/src/server.js` is untouched — `npm run dev:server` and a classic VPS/Render
  deployment (`npm start --prefix server`) still work exactly as before. If the API ever
  outgrows serverless (websockets, cron, heavy uploads), deploy `server/` to
  Render/Railway and keep Vercel for the client: set `apiUrl` in `environment.prod.ts`
  to the API's absolute URL and `CLIENT_URL` on the server to the Vercel origin.
