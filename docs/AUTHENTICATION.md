# Authentication

NOMA has two ways to sign in, and both end in the same session: a short-lived JWT access token (15 minutes by default) and a rotating refresh token stored hashed in MongoDB.

## Flows

**Email and password**
1. `POST /api/auth/signup` (name, email, 12+ character password). The answer is the same whether or not the email exists. A new account is always a `CUSTOMER`, unverified.
2. A 6-digit code is emailed. It is stored as an HMAC, expires after 10 minutes, allows 5 attempts and works once. Resend (`/resend-otp`) waits 60 seconds between codes and replaces the old one.
3. `POST /api/auth/verify-email`, then `POST /api/auth/login`. An unverified account gets `403 Email not verified` (only after the right password), so it cannot reach any customer feature.
4. Forgot password: `POST /api/auth/forgot-password` (same answer for unknown emails) emails a reset code with the same rules; `POST /api/auth/reset-password` sets the new password and **ends every session**: refresh tokens are revoked and `tokenVersion` is bumped, so even unexpired access tokens stop working.

**Continue with Google** (Google Identity Services, popup mode)
1. The page asks `GET /api/auth/google/nonce` for a random nonce plus a signed 10-minute ticket.
2. Google's button is initialised with that nonce; after consent Google returns an **ID token** (a JWT signed by Google) that contains it.
3. The page posts `{ credential, nonceToken }` to `POST /api/auth/google`. Nothing else: no name, email or role is ever taken from the browser.
4. The API verifies the ID token with Google's official library (`google-auth-library`): RS256 signature against Google's published keys, issuer (`accounts.google.com`), audience (our client id) and expiry. It then requires `email_verified`, and that the token's nonce matches a valid ticket that has not been used before.
5. Account rules:
   - Known Google account (`sub`) → sign in.
   - New email → create a verified `CUSTOMER` (never admin, never demo) with an unusable random password; a password can be set later with "Forgot password".
   - Existing verified customer with that email → link Google to it (no duplicate account).
   - Existing **unverified** customer → link, **replace its password and end its sessions**: whoever registered the address without proving it loses access (pre-hijacking defence).
   - Admin or demo account with that email → `403`; staff and demo accounts only sign in with their password.
   - Email already linked to a different Google account → `409`.

**Errors the user sees:** cancelled popup → nothing happens; invalid/expired/replayed token → `401 Google sign-in could not be verified`; unverified Google email → `403`; Google not configured → the button is hidden and the API answers `503`.

## Security summary

Rate limits per client address (in memory, per API process): login 30 failures and 5 per account per 15 minutes; Google 30 attempts per 15 minutes; emails 10 per hour; code checks 20 failures per 15 minutes; refresh 60 per 15 minutes. Answers never reveal whether an email is registered. Codes and reset tokens are never returned by the API and never logged in production (`console` mail transport is refused there).

## Environment variables

| Where | Variable | Value |
|---|---|---|
| API | `GOOGLE_CLIENT_ID` | OAuth Web client id, for example `1234-abc.apps.googleusercontent.com` |
| Web (build time) | `VITE_GOOGLE_CLIENT_ID` | The same client id |
| API | `MAIL_TRANSPORT` | `smtp` for real email (`disabled` = none, `console` = development only) |
| API | `SMTP_URL` | `smtps://USER:PASSWORD@HOST:465` (URL-encode special characters) |
| API | `MAIL_FROM` | `NOMA <no-reply@your-domain>` (an address the provider lets you send from) |

No Google client **secret** is needed: the browser flow returns an ID token that the API verifies with public keys.

## Google Cloud setup (free)

1. <https://console.cloud.google.com/> → create a project (for example "NOMA").
2. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience): app name *NOMA*, your support email, user type **External**, publishing status *Testing* (add your own Google account as a test user) or *In production* for anyone. Scopes: the defaults `openid`, `email`, `profile` only; no verification review is needed for these.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
4. **Authorised JavaScript origins:**
   - `http://localhost:5173` (local storefront)
   - `http://localhost` (Google requires the bare origin too for some localhost setups)
   - `https://noma-hebaashraf.onrender.com` (production storefront)
5. **Authorised redirect URIs:** none. Popup mode posts the ID token to the page itself; there is no redirect.
6. Copy the **Client ID** into `GOOGLE_CLIENT_ID` (API) and `VITE_GOOGLE_CLIENT_ID` (web), redeploy both.

## Email provider (free tiers, no card needed)

Any SMTP provider works. Two good free options:

- **Brevo**: 300 emails/day free. Settings → SMTP & API → create an SMTP key. `SMTP_URL=smtp://LOGIN:SMTP_KEY@smtp-relay.brevo.com:587`, verify the sender address you put in `MAIL_FROM`.
- **Resend**: 3,000 emails/month free (100/day). Create an API key and verify a domain (or use their test sender for your own address only). `SMTP_URL=smtps://resend:API_KEY@smtp.resend.com:465`.

Then set `MAIL_TRANSPORT=smtp`, `SMTP_URL` and `MAIL_FROM` on the API and redeploy.
