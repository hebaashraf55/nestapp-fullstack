# NOMA — full-stack home decor storefront

*Thoughtful objects. Timeless spaces.*

NOMA is a portfolio e-commerce project: a **NestJS + MongoDB API** and a **React storefront** with a warm Scandinavian editorial design, light mode by default and an optional dark mode.

**Live demo:** _added after deployment_ · **API docs:** `<api-url>/api/openapi.json`

> **Checkout is simulated.** There is no payment gateway and the app never asks for or stores card data. Every order's payment state contains `SIMULATED`, and the API refuses to start unless `PAYMENTS_MODE=simulated`. All products, brands and prices are invented demo data; product photos are from Unsplash (credits in [`web/public/catalogue/CREDITS.md`](web/public/catalogue/CREDITS.md)).

## Features

**Storefront**
- Homepage with a sticky category sidebar (chips on phones), eight pieces per category, and featured, new, on-sale, best-selling (from real paid orders) and recently viewed rows
- Catalogue of 56 pieces in 7 categories, with search (also by material, colour, category and maker), filters, price range, sorting and pagination
- Wishlist and recently viewed: kept in the browser for guests, merged into the account at sign-in
- Side-by-side comparison of up to four pieces with their specifications
- Reviews with star ratings, a rating breakdown and a “verified purchase” badge decided by the server from paid orders; every review is moderated before it appears
- Product pages with photography and server-computed sale prices
- Cart priced by the server on every read, stock checks, coupons
- Checkout that reserves stock for 30 minutes, then a one-click *simulated* payment
- Order history and order detail; unpaid orders expire automatically and release their stock
- Light mode by default, dark mode as a remembered choice; responsive down to phone widths

**Admin** (`/admin`)
- Dashboard: customers, orders by status, simulated paid/refunded totals, stock alerts
- **Products:** list with search and filters, create, edit (only changed fields are sent), relative stock changes that never go below zero, delete with confirmation (refused while an open order still holds the product)
- **Coupons:** percentage coupons with expiry, edit, pause/activate, delete, orders-per-code
- Orders: status changes along a state machine, simulated refunds that restore stock
- **Reviews:** moderation queue to approve or reject (with a note to the author)
- Customers with masked names and emails, and an append-only audit log of every admin change

**Roles and security**
- Email + password accounts with emailed verification codes, forgot/reset password, and **Continue with Google** (ID token verified on the server, nonce-protected, customers only)
- Deny-by-default authentication with short-lived access tokens and rotating refresh tokens
- `ADMIN`, `CUSTOMER` and a read-only `DEMO_VIEWER` that sees only synthetic records; all enforced on the server (403), not just hidden in the UI
- Helmet headers, exact-match CORS allow-list, request throttling, login and coupon-guess limits, validated input everywhere (Zod), NoSQL-operator injection guarded in repositories

## Tech stack

| Layer | Technology |
|---|---|
| API | NestJS 11, TypeScript (strict), Mongoose, Zod, Helmet |
| Database | MongoDB (local Docker or MongoDB Atlas) |
| Web | React 19, React Router, Vite, Framer Motion, plain CSS design tokens |
| Tests | Jest + Supertest (API), real-MongoDB integration suites, Vitest + Testing Library (web) |
| Hosting | Render (free web service + free static site) with MongoDB Atlas (free M0) — see [Deploy](#deploy) |

## Demo accounts

The seed creates three accounts:

| Account | Role | What it can do |
|---|---|---|
| `demo-customer@example.com` | Customer | Shop, check out with the simulated payment, see order history |
| `demo-viewer@example.com` | Demo viewer | Browse the admin area read-only (synthetic records only, every write is 403) |
| `SEED_ADMIN_EMAIL` | Admin | Everything; the owner's private account |

Both demo accounts share `SEED_DEMO_PASSWORD`, which the person running the app chooses. Visitors can also create their own customer account with Google, or by email once an email provider is configured. Google and email sign-up only ever create customer accounts. Setup: [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).

## Run locally

Requires **Node.js 24** (or 22) and Docker Desktop for the local MongoDB.

```bash
npm ci && (cd web && npm ci)
cp .env.example .env      # then set your own passwords and a JWT secret: openssl rand -base64 48
npm run db:up             # MongoDB on 127.0.0.1 only
npm run seed              # admin + demo accounts
npm run seed:catalogue    # 3 brands, 7 categories, 56 products (safe to re-run, never overwrites)
npm run start:dev         # API on http://localhost:5000 (PORT in .env)
cd web && npm run dev     # storefront on http://localhost:5173, proxies /api to the API
```

### Environment variables

All configuration is validated at startup; the API refuses to start with a bad or missing value. The full list with comments is in [`.env.example`](.env.example).

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development`, `test` or `production` |
| `PORT` | API port (hosting providers set this) |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API (exact match) |
| `PAYMENTS_MODE` | Must be `simulated` |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | At least 32 characters; placeholders are refused in production |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS` | Token lifetimes |
| `MAIL_TRANSPORT` | `console` (development only), `smtp` (with `SMTP_URL`, `MAIL_FROM`) or `disabled` (public demo without email) |
| `TRUST_PROXY` | Number of proxy hops in front of the API (1 on Render) |
| `THROTTLE_LIMIT`, `THROTTLE_WINDOW_SECONDS` | Request throttle per client address |
| `OPENAPI_ENABLED` | Serve `/api/openapi.json` in production when `true` |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client id; unset switches Google sign-in off |
| `SMTP_URL`, `MAIL_FROM` | Email provider when `MAIL_TRANSPORT=smtp` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD` | Accounts created by the seed (placeholders refused in production) |
| `VITE_API_BASE_URL` (web) | Absolute API URL when the storefront and API are on different hosts |
| `VITE_GOOGLE_CLIENT_ID` (web) | Same Google client id; unset hides the Google button |

## Deploy

[`render.yaml`](render.yaml) is a Render Blueprint that creates both services on free plans:

1. **MongoDB Atlas:** create a free M0 cluster, a database user, allow network access from `0.0.0.0/0`, and copy the `mongodb+srv://…/noma` connection string.
2. **Render:** *New → Blueprint*, choose this repository, and fill in `MONGODB_URI`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD` when asked (`JWT_SECRET` is generated by Render).
3. The API runs both idempotent seeds on start, then serves `/api/health`. If Render assigns different URLs than `noma-hebaashraf-api.onrender.com` / `noma-hebaashraf.onrender.com`, update `CORS_ORIGINS` (API) and `VITE_API_BASE_URL` (web) and redeploy.

Free Render web services sleep after 15 minutes without traffic, so the first request after a pause takes up to a minute.

## Scripts and checks

| Command | What it does |
|---|---|
| `npm run lint` / `typecheck` / `format:check` / `build` | API quality gates |
| `npm test` | API unit and HTTP tests (in-memory stores) |
| `npm run test:db` | Real-MongoDB repository tests and the end-to-end API suite (needs `MONGODB_TEST_URI`) |
| `npm run docs:openapi` | Regenerate [`docs/openapi.json`](docs/openapi.json) |
| `cd web && npm run lint && npm run typecheck && npm run build && npm test` | Storefront gates |

## Documentation

- [`docs/BACKEND-VERIFICATION.md`](docs/BACKEND-VERIFICATION.md) — how every backend feature is proven (HTTP tests, real-MongoDB tests, end to end with a restart)
- [`docs/API-CHANGELOG.md`](docs/API-CHANGELOG.md) — how the API differs from the original course project
- [`docs/openapi.json`](docs/openapi.json) — machine-readable API description
- [`docs/test-matrix.md`](docs/test-matrix.md) — per-endpoint test evidence generated from real test runs
- [`docs/PHASE-1-PLAN.md`](docs/PHASE-1-PLAN.md), [`docs/LOCAL-DEMO.md`](docs/LOCAL-DEMO.md) — plan and Mac demo guide

## Origin

The domain model is adapted from my earlier course project [`nestapp`](https://github.com/hebaashraf55/nestapp), which is left untouched. This repository is an independent rewrite with fresh history, strict TypeScript and tests.

## License

MIT
