export const environment = {
  production: true,
  // '/api' works when the client and API share an origin behind a reverse
  // proxy. If they're hosted separately, set the absolute API URL here
  // (e.g. 'https://api.your-domain.com/api').
  apiUrl: '/api',
  // Google OAuth Web Client ID — same value as the server's GOOGLE_CLIENT_ID.
  googleClientId: '',
  // GA4 measurement id (G-XXXXXXX) — blank disables analytics entirely.
  gaMeasurementId: '',
  // Firebase web config (SAFE to commit — public identifiers, not secrets).
  // From: Firebase console -> Project settings -> General -> "Your apps" (Web app).
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: '',
  },
};
