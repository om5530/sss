export const environment = {
  production: false,
  // Dev server proxies /api -> http://localhost:4000 (see proxy.conf.json).
  apiUrl: '/api',
  // Set to your Google OAuth Web Client ID to enable the Google sign-in button.
  googleClientId: '',
  // GA4 measurement id (G-XXXXXXX) — blank disables analytics entirely.
  gaMeasurementId: '',
  // Firebase web config (SAFE to commit — these values are public identifiers,
  // not secrets). Fill in to enable real SMS OTP login; leave apiKey blank to
  // fall back to the backend mock-OTP flow in local dev.
  // From: Firebase console -> Project settings -> General -> "Your apps" (Web app).
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: '',
  },
};
