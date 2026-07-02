# Ideas Backlog — Sweet Savory Savor

Future features and improvements beyond the shipped roadmap (see `PRE-LAUNCH-CHECKLIST.md` for what's already built).
Nothing here is committed work — it's a menu to pick from, roughly ordered by value within each theme.

**Tags:** Impact ★–★★★ · Effort S (hours) / M (days) / L (week+) / XL (project)

---

## 1. Sell more (customer-facing)

| Idea | What it is | Impact | Effort |
|---|---|---|---|
| **WhatsApp order updates** | "Order confirmed / ready" via WhatsApp (Meta Cloud API or Interakt/Wati). In India this beats email 10-to-1. The notify.service hooks already exist — swap the channel. | ★★★ | M |
| **Order scheduling / pre-orders** ✅ DONE 2026-07-03 | "Pick up at 6 pm" time slots; order tomorrow's bake today. Bakeries live on pre-orders; pairs beautifully with stock tracking (tomorrow's counts). | ★★★ | M |
| **QR table ordering** ✅ DONE 2026-07-03 | Printed QR per table → menu opens with `?table=12` pre-filled → dine-in order without staff. The dine-in flow + table field already exist. | ★★★ | S–M |
| **"Order again"** ✅ DONE 2026-07-03 | One tap on any past order re-fills the cart (order history already stores line items). | ★★ | S |
| **Loyalty / punch card** | Points per ₹ or "9 brownies → 10th free". Coupon engine is a head start; needs a per-customer ledger. | ★★ | M |
| **Combos & upsells** | Breakfast box bundles; "pairs well with ☕" suggestion in cart based on category affinity. | ★★ | M |
| **Back-in-stock notify** | "Tell me when it's back" on sold-out items — stock tracking already flips availability, so the trigger exists. | ★★ | S–M |
| **Gift cards / cake vouchers** | Prepaid codes redeemable at checkout — reuses most of the coupon plumbing. | ★★ | M |
| **Live order status without refresh** ✅ DONE 2026-07-03 | Poll or SSE on the order page so "preparing → ready" appears live. | ★★ | S–M |
| **Referral codes** | "Give ₹50, get ₹50" — per-customer generated coupons (engine exists) + attribution. | ★ | M |
| **Allergen & nutrition info** | Fields on Product + badges on cards; useful for cakes (nuts, gluten, egg already tracked as dietary). | ★ | S |
| **Hindi / Marathi storefront** | Angular i18n or runtime dictionary; big for Dahisar walk-in demographic. | ★ | L |

## 2. Run the shop better (operations)

| Idea | What it is | Impact | Effort |
|---|---|---|---|
| **Staff PWA push alerts** (queue polling + chime already live; web-push still open) | Web-push "new order!" to the admin PWA + a chime in the live queue. Kills the "missed an order" problem. PWA + queue already exist. | ★★★ | M |
| **Daily prep sheet** ✅ DONE 2026-07-03 | Morning report aggregating today's pre-orders + yesterday's sell-outs by product ("bake 24 brownies"). One aggregation + one admin page. | ★★★ | S–M |
| **Printable KOT / receipt** ✅ DONE 2026-07-03 | Print-CSS kitchen ticket + customer bill from the order page. | ★★ | S |
| **Business hours enforcement** ✅ DONE 2026-07-03 | Reject/queue orders outside 8:00–22:00 + a holiday calendar; today the store never closes. | ★★ | S–M |
| **Delivery zones & fees** | Pincode-based zones, per-zone fee/minimum instead of the flat ₹40; optionally a Porter/Dunzo/Shadowfax API handoff for riders. | ★★ | M–L |
| **Staff roles** | `staff` role between customer and admin: queue + orders only, no products/coupons/reports. One enum value + route guards. | ★★ | M |
| **Partial refunds** | Refund a single item, not just the whole order (Razorpay supports partial amounts). | ★★ | M |
| **Review replies + moderation** | Shop response under a review; hide abusive ones from the admin panel. | ★ | M |
| **Customer notes / tags** | "Always extra-baked", "VIP", allergy flags on the customer record, visible in the queue. | ★ | S |
| **Ingredient-level inventory** | Recipes per product → flour/butter stock math → low-supply alerts. Powerful but a genuinely big system. | ★★ | XL |

## 3. Marketing & growth

| Idea | What it is | Impact | Effort |
|---|---|---|---|
| **Festival pre-order pages** | Diwali hampers / Christmas cakes: a themed landing page + limited-window pre-orders + advance payment. India's bakery revenue spikes live here. | ★★★ | M |
| **Campaign blasts** | Email (Resend is wired) and/or WhatsApp broadcast to opted-in customers: new menu, weekend specials. Needs opt-in flag + a small admin composer. | ★★ | M |
| **Abandoned-cart nudge** | Cart is client-side today; persist carts for signed-in users → "your brownies are waiting" email after 24 h. | ★★ | M |
| **Google Business Profile funnel** | "Loved it? Review us on Google" link after a completed order; GBP drives local discovery more than any SEO. | ★★ | S |
| **Instagram feed on home** | Embed the shop's latest posts (Behold/LightWidget or Graph API) — bakeries sell through photos. | ★ | S |
| **Blog / recipe pages** | Long-tail SEO ("best brownies in Dahisar") — becomes much stronger after SSR. | ★ | L |

## 4. Platform & engineering

| Idea | What it is | Impact | Effort |
|---|---|---|---|
| **Redis-backed rate limits** (Upstash) | ⚠️ On Vercel, `express-rate-limit`'s memory store is **per-lambda-instance**, so limits are much weaker than designed. Same for the in-process review-stats queue. An Upstash Redis store fixes both properly. First engineering task once real traffic exists. | ★★★ | S–M |
| **CI on GitHub Actions** ✅ DONE 2026-07-03 | Run the 13 server tests + client build on every push/PR — auto-deploy currently ships untested pushes. | ★★★ | S |
| **Error monitoring** (Sentry) | Client + server; without it, production bugs are invisible until a customer complains. | ★★★ | S |
| **Full SSR** *(deferred from roadmap)* | Angular SSR on Vercel for real SEO indexing; do when organic traffic becomes a goal. | ★★ | L |
| **E2E browser tests** (Playwright) | Checkout, coupon, cash flow, admin queue — the flows unit tests can't cover. | ★★ | M |
| **Image pipeline** | Cloudinary transforms (`f_auto,q_auto,w_...`) + `srcset` — uploaded phone photos are multi-MB. | ★★ | S–M |
| **Account linking** *(deferred from roadmap)* | Merge phone + Google identities; needs product decisions on ownership proof. | ★ | L |
| **Real SMS OTP provider** (MSG91) | Alternative to Firebase for OTP; needs DLT registration. Only if Firebase pricing/UX disappoints. | ★ | M |
| **Uptime monitor + status** | UptimeRobot/BetterStack ping on `/api/health` with WhatsApp/email alert. | ★ | S |
| **Automated Atlas backups check** | Verify backup policy + a documented restore drill. | ★ | S |

---

## Suggested picking order (when next week's work is done)

1. **CI + Sentry + Redis rate limits** — one hardening day; everything after ships safer
2. **WhatsApp updates + staff push alerts** — the two "shop feels alive" features
3. **Pre-orders/scheduling + daily prep sheet** — turns the site into the bakery's operating system
4. **QR table ordering + festival pages** — revenue features with visible wow

*For the multi-tenant SaaS direction, see `SAAS-PLAN.md`.*
