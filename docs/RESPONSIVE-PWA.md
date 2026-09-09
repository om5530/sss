# Responsive layout and app installation

The storefront provides an install card above the footer on mobile and tablet browsers in a secure context. Android browsers supporting `beforeinstallprompt` show an **Install app** button once the browser offers installation. Other browsers show home-screen instructions; iPhone and iPad users are directed to Safari's Share → Add to Home Screen flow. The card hides in standalone mode or after installation. **Not now** dismisses it for seven days on that browser.

The existing Angular production service worker and app icons power the installed web app. The manifest supports portrait and landscape. Orders, payments and live updates require connectivity. This is a home-screen web app, not an App Store or Play Store package.

## Local verification

- Production Angular build passed; the existing `qrcode` CommonJS warning remains.
- Checked 32 storefront/admin routes at 320, 390, 768, 820, 1024 and 1366 CSS pixels using Edge browser automation and mocked API data. Fixed detected header, homepage ribbon, contact, profile and admin overflow. Rechecked the final 320px profile fix separately.
- Checked guest login at 320, 390 and 768px, including resizing the Google sign-in button; checked landscape mobile navigation, including scrolling and closing the menu.
- Tested Android, iPhone and iPad detection, fallback instructions, simulated native install prompt, dismissal persistence and installed-event hiding. Desktop does not show the card.
- Verified the production service worker becomes active and the manifest loads from a separate local production preview.

These are browser-emulated checks, not physical-device certification. Actual native installation should also be checked on an Android phone and iPhone/iPad when HTTPS hosting is available. Development `ng serve` disables the service worker: the card can show instructions locally, but the full install experience needs a production build over HTTPS (localhost is permitted for local development). Plain HTTP over a laptop's LAN IP does not qualify as a secure context.

No deployment was performed for this change.
