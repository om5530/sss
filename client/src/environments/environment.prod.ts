export const environment = {
  production: true,
  // '/api' works when the client and API share an origin behind a reverse
  // proxy. If they're hosted separately, set the absolute API URL here
  // (e.g. 'https://api.your-domain.com/api').
  apiUrl: '/api',
  // Google OAuth Web Client ID — same value as the server's GOOGLE_CLIENT_ID.
  googleClientId: '446405901962-v80qvjniu6r6cptauve5kt4f06lb340a.apps.googleusercontent.com',
  // GA4 measurement id (G-XXXXXXX) — blank disables analytics entirely.
  gaMeasurementId: '',
  // Firebase web config (SAFE to commit — public identifiers, not secrets).
  // From: Firebase console -> Project settings -> General -> "Your apps" (Web app).
  firebase: {
    apiKey: 'AIzaSyC_Apc-tNLP6fxefBi-FGSfyc17Z0mcCOE',
    authDomain: 'ssss-ade3d.firebaseapp.com',
    projectId: 'ssss-ade3d',
    appId: '1:446405901962:web:a365bc2c68f90353a3b773',
  },
};
