export const environment = {
  production: false,
  // Dev server proxies /api -> http://localhost:4000 (see proxy.conf.json).
  apiUrl: '/api',
  // Set to your Google OAuth Web Client ID to enable the Google sign-in button.
  googleClientId: '446405901962-v80qvjniu6r6cptauve5kt4f06lb340a.apps.googleusercontent.com',
  // GA4 measurement id (G-XXXXXXX) — blank disables analytics entirely.
  gaMeasurementId: '',
  // Firebase web config (SAFE to commit — these values are public identifiers,
  // not secrets). Fill in to enable real SMS OTP login; leave apiKey blank to
  // fall back to the backend mock-OTP flow in local dev.
  // From: Firebase console -> Project settings -> General -> "Your apps" (Web app).
  firebase: {
    apiKey: 'AIzaSyC_Apc-tNlP6fxefBi-FGSfyc17Z0mcCOE',
    authDomain: 'ssss-ade3d.firebaseapp.com',
    projectId: 'ssss-ade3d',
    appId: '1:446405901962:web:a365bc2c68f90353a3b773',
  },
};
