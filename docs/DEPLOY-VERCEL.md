# Deploying on Vercel (no card needed)

Two Vercel projects from this one repository, plus MongoDB Atlas (free M0):

| Project | Root directory | What it serves |
|---|---|---|
| Storefront | `web` | the React site (`web/vercel.json`) |
| API | repository root (`.`) | `/api/**` as one serverless function (`api/[...path].js`, `vercel.json`) |

## What changes when the API is serverless

The API runs per request instead of as one long-lived process, so:

- **No live updates:** Socket.io needs a persistent server. The storefront sets `VITE_REALTIME=off`; the
  notification bell and order pages still refresh by polling/reloading.
- **No background worker:** queued email is attempted right away; if it fails, the job stays in
  Admin -> Jobs and can be retried there. Unpaid orders expire when they are next read (the order page,
  checkout, the cart), which restores their stock.
- **Per-instance memory:** the rate limiter, login lockout counters and the homepage cache live in each
  function instance. Limits are therefore softer than on a single server (an attacker can be spread over
  instances) and the homepage can be up to 60 s stale. Everything that matters for correctness (stock
  reservation, coupon limits, one default address…) is enforced in MongoDB, not in memory.
- **Cold starts:** the first request after idle takes a few seconds.

## API project: environment variables

Set these in Vercel -> Project -> Settings -> Environment Variables (Production). Secrets are typed there,
never committed:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PAYMENTS_MODE` | `simulated` |
| `TRUST_PROXY` | `1` |
| `MONGODB_URI` | the Atlas string for `noma-app-user`, ending in `/noma?retryWrites=true&w=majority` |
| `JWT_SECRET` | at least 32 random characters (`openssl rand -base64 48`) |
| `CORS_ORIGINS` | the storefront's exact URL, e.g. `https://nestapp-fullstack.vercel.app` |
| `MAIL_TRANSPORT` | `disabled` (no email provider) or `smtp` with `SMTP_URL` and `MAIL_FROM` |
| `OPENAPI_ENABLED` | `true` (optional) |
| `GOOGLE_CLIENT_ID` | optional; see AUTHENTICATION.md |

## Storefront project: environment variables

| Name | Value |
|---|---|
| `VITE_API_BASE_URL` | the API project's URL, no trailing slash |
| `VITE_REALTIME` | `off` |
| `VITE_GOOGLE_CLIENT_ID` | optional |

Redeploy the storefront after changing these (they are baked in at build time).

## First-time data

The serverless API does not seed. Run the seeds once from your computer against Atlas (type the values in
your own terminal; do not paste them anywhere else):

```bash
export MONGODB_URI='mongodb+srv://noma-app-user:PASSWORD@cluster0.xxxxx.mongodb.net/noma?retryWrites=true&w=majority'
export JWT_SECRET='the same value as in Vercel'
export SEED_ADMIN_EMAIL='you@example.com' SEED_ADMIN_PASSWORD='a strong password' SEED_DEMO_PASSWORD='another one'
npm run seed             # admin + the two demo accounts
npm run seed:catalogue   # brands, categories, 56 products, sets and looks (safe to re-run)
```

## Check it

`GET <api-url>/api/health/ready` must answer `{"status":"ready","checks":{"database":"up",…}}`.
