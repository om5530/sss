# Real SMS phone login

Provider review: 2026-09-09. The application uses the existing Firebase Phone Authentication integration, now with runtime public configuration and no production mock fallback.

| Provider | Free allowance verified | Notes |
|---|---|---|
| Firebase / Google Identity Platform | First 10 SMS per day not billed | Daily allowance, not a monthly pool. India overage is listed at USD 0.07 per SMS. Billing-enabled Blaze plan required for Firebase verification SMS. |
| Twilio Verify | Trial offered | No recurring free monthly SMS allowance verified. Verify and SMS charges are separate. |
| MSG91 | Free widget advertised | Free widget does not establish free SMS delivery; channel usage is billed separately. |
| 2Factor | Paid OTP pricing published | No recurring free monthly OTP allowance verified. |

Sources: [Google pricing](https://cloud.google.com/identity-platform/pricing), [Firebase limits](https://firebase.google.com/docs/auth/limits), [Twilio Verify pricing](https://www.twilio.com/en-us/verify/pricing), [MSG91 subscription](https://msg91.com/help/sendotp/how-to-integrate-the-new-login-with-otp-widget/msg91-otp-widget-subscription-), [2Factor pricing](https://2factor.in/v4/pricing.html).

## Activation

### reCAPTCHA verifier (step 2 in Firebase's web guide)

Implemented in `client/src/app/core/services/firebase-phone.service.ts`. Clicking Send OTP renders Firebase's invisible `RecaptchaVerifier` in the persistent login-page container, then passes it to `signInWithPhoneNumber`. Firebase runs the challenge as needed; there is no separate site-key/secret-key registration. The verifier is cleared after send success/failure and on page exit; retries create a new verifier. Late results from abandoned requests are discarded. The SMS confirmation is retained for the code-entry step.

Live verification still requires configured web-app values and an authorized hosted domain. A successful build does not certify a live reCAPTCHA or SMS delivery test.

### Firebase project configuration

1. Use a Firebase project with Authentication enabled and a billing-enabled plan. Review charges in the provider console before activation.
2. Enable Phone sign-in. Configure the SMS region policy for intended destinations (India for this store), and add the deployed storefront domain to Authorized domains. Follow the [official web setup](https://firebase.google.com/docs/auth/web/phone-auth).
3. Register a Firebase web app. Set these server environment variables from its web config: `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_WEB_APP_ID`, and `FIREBASE_PROJECT_ID`.
4. Configure the same project's service account using `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` in the hosting secret manager or local ignored `server/.env`. Do not paste private keys into chat or commit them. The public web config endpoint never returns these credentials.
5. Set `OTP_PROVIDER=firebase`, remove `EXPOSE_DEV_OTP`, and restart/redeploy the API and client. Client static Firebase configuration remains a fallback for existing installations, but runtime configuration takes precedence.
6. Check `/api/auth/phone-config`: expect `mode: firebase`. Use provider test numbers first, then perform a real SMS sign-in on the authorized deployed domain. A live SMS smoke test has not been performed in this task.

SMS sends use Firebase reCAPTCHA. API exchanges verify signed, non-revoked ID tokens and require phone-provider authentication within the last five minutes. Firebase browser persistence is memory-only and is cleared after obtaining the token. The app then issues its own session, retaining account deactivation and logout behavior.

Production mock request/verification endpoints are disabled even with the old demo flag. Missing configuration results in an unavailable message, not a fake SMS. Local mock mode remains available only without configured Firebase credentials. Configure provider-side quotas/region restrictions and billing alerts; alerts alone do not cap charges, and a daily free allowance is not an app-level spending cap.

Outstanding: Firebase project credentials, console activation/billing, authorized domain and a real delivery test. No provider account or billing changes were made.
