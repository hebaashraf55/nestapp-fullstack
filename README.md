# nestapp-fullstack

A full-stack e-commerce portfolio project: a **NestJS + MongoDB API** (Phase 1) and a **React storefront** (Phase 2).

> **Status: Phase 1 in progress; Phase 2 frontend foundation started.** The API has only its foundation (configuration, security headers, CORS allow-list, response envelope, error handling, health check). The React app in `web/` is a shell that calls the one endpoint that exists. Nothing is deployed. There is no live demo yet.

## Important: checkout is simulated

This project has **no payment gateway and handles no card data**. Orders can be paid by cash on delivery or by a clearly labelled *simulated* payment step in which no money moves. Every simulated order is stored with a `SIMULATED` status and a note saying so. The app refuses to start if `PAYMENTS_MODE` is set to anything other than `simulated`.

## Origin

The domain model and business flows are adapted from my earlier course project [`nestapp`](https://github.com/hebaashraf55/nestapp), which is left untouched. This repository is an independent rewrite with fresh history, strict TypeScript, and tests.

## What works today

| Area | State |
|---|---|
| `GET /api/health` | Implemented and tested |
| Validated configuration (`PORT`, `CORS_ORIGINS`, `PAYMENTS_MODE`, `NODE_ENV`) | Implemented and tested |
| Helmet security headers, exact-match CORS allow-list | Implemented and tested |
| `{ success, data, timestamp }` response envelope and safe error envelope | Implemented and tested |
| React + TypeScript + Vite shell in `web/` (animated landing, live API status, reduced-motion support) | Implemented and tested; storefront pages `/shop` and `/shop/:id` plus a home-page new-arrivals row read the real catalogue API. cart, checkout and order pages added in Step 6 |
| MongoDB connection, `User` model with roles (`CUSTOMER`, `ADMIN`, `DEMO_VIEWER`), scrypt password hashing | Implemented. Mongoose-backed tests are written but have **not been run** (no MongoDB in the build sandbox) |
| Global deny-by-default `AuthGuard`, `RolesGuard`, read-only enforcement for the demo viewer, demo-data scope helper | Implemented and tested (in-memory user store). Tokens can't be obtained yet: login is Step 3 |
| Seed script (owner admin from env vars, synthetic demo accounts), `docker-compose.yml` | Implemented; seed logic tested in memory, real-database run pending on your machine |
| Authentication: signup, email code verification, login, rotating refresh tokens, logout, logout-all, forgot/reset password, profile | Implemented and tested over HTTP with in-memory stores. Mongoose-backed repositories are written but **their tests have not been run** |
| Catalogue: brands, categories, products with admin-only CRUD, public search / filter / sort / pagination, demo viewer limited to synthetic records | Implemented and tested over HTTP with in-memory stores. Mongoose repositories and the `seed:catalogue` script are written but **have not been run against a real MongoDB** |
| Coupons (admin CRUD) and the cart: add / view / change quantity / remove / apply coupon, server-side pricing, stock checks, live recalculation | Implemented and tested over HTTP with in-memory stores. Mongoose repositories are written but **have not been run against a real MongoDB** |
| Storefront sign-in, cart page and add-to-cart | Implemented and tested against mocked API responses; exercised in a real browser against an in-memory API |
| Orders and simulated payments: place order from cart, 30-minute stock hold, one-click `simulate-payment`, expiry, owner history, admin status changes and simulated refunds. Storefront `/checkout`, `/orders`, `/orders/:id` | Implemented and tested over HTTP with in-memory stores and against mocked API responses; exercised in a real browser against an in-memory API. Mongoose order and stock code **has not been run against a real MongoDB** (6 new skipped DB tests) |
| Admin and demo viewer: masked customer list, dashboard stats, admin order list with status and simulated-refund actions, append-only audit log, demo viewer limited to synthetic read-only data. Storefront `/admin`, `/admin/orders`, `/admin/customers`, `/admin/audit` | Implemented and tested over HTTP with in-memory stores and against mocked API responses; exercised in a real browser against an in-memory API. New MongoDB queries **have not been run against a real MongoDB** (6 more skipped DB tests, 42 in total) |
| Orders, simulated payments, admin dashboards | **Not started** — see [the Phase 1 plan](docs/PHASE-1-PLAN.md) |

## Quick start

Requires **Node.js 24 (Active LTS, recommended)** or Node.js 22 (Maintenance LTS). Node.js 20 reached end of life on 30 April 2026 and is not supported. `.nvmrc` pins 24.

```bash
npm ci
cp .env.example .env     # edit if needed; never commit .env
npm run start:dev        # http://localhost:5000/api/health
```

### Run the web app locally

```bash
npm run build && node dist/main.js     # API on http://localhost:5000
cd web && npm ci && npm run dev        # http://localhost:5173 (proxies /api to :5000)
```

### Local database and seed accounts (needs Docker Desktop, which is free for personal use)

```bash
cp .env.example .env     # then edit: set your own passwords and a JWT_SECRET (see comments in the file)
npm run db:up            # starts MongoDB on 127.0.0.1:27017 only
npm run seed             # creates the owner admin plus demo-customer / demo-viewer accounts
npm run seed:catalogue   # 3 brands, 4 categories, 12 synthetic products (all flagged isDemo); safe to re-run
npm run test:db          # optional: runs the MongoDB-backed tests (set MONGODB_TEST_URI in .env first)
npm run db:down          # stops the database (data stays in a Docker volume)
```

Credentials come only from `.env` (git-ignored). `SEED_ADMIN_*` is your private owner account; the demo accounts hold synthetic data only. The seed never overwrites an existing password or promotes an existing account. Generate a secret with `openssl rand -base64 48`.

## Authentication API (`/api/auth`)

| Route | Access | Notes |
|---|---|---|
| `POST signup` | public | `{ email, password (12–128 chars), name }`. Unknown fields such as `role` are rejected with 400. Always answers 202 with the same body |
| `POST verify-email` | public | `{ email, code }`, a 6-digit code valid 10 minutes, 5 attempts, single use |
| `POST resend-otp` | public | same generic 202; at most one email a minute per account |
| `POST login` | public | returns `{ Credentials: { accessToken, refreshToken }, user }`. Access token lives 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`) |
| `POST refresh` | public | rotates the refresh token; reusing an old one revokes that whole session |
| `POST logout` | public | `{ refreshToken }` ends that one session. Works for demo viewers; changes nothing else |
| `POST logout-all` | signed in | ends every session and invalidates all access tokens. **Blocked for demo viewers** |
| `GET profile` | signed in | the safe user view, never the password hash |
| `POST forgot-password`, `POST reset-password` | public | generic 202; reset also signs everyone out. Not available for demo accounts |

Errors use the standard envelope. Login failures are always `401 Invalid email or password`. Too many attempts return `429` with `Retry-After`.

**Brute-force protection today:** 5 failed logins per account and 30 per IP address per 15 minutes; 10 email-sending requests per IP per hour; 20 failed code checks per IP per 15 minutes; codes lock after 5 wrong attempts. **Deferred to Step 8:** these counters live in the server's memory (reset on restart, not shared between instances), `trust proxy` is not configured (behind a proxy every visitor shares one address), and a determined attacker can temporarily lock a known account by failing logins against it.

## Catalogue API (`/api/brand`, `/api/category`, `/api/product`)

Each resource has the same shape. Paths keep the original API's `create` convention for creation.

| Route | Access | Notes |
|---|---|---|
| `GET /` and `GET /:id` | public | A signed-in demo viewer is recognised and sees **only synthetic (`isDemo`) records**; real ones answer 404, never 403 |
| `POST /create` | admin only | Unknown fields (`isDemo`, `salePriceCents`, ...) are rejected with 400; the server sets `isDemo: false` |
| `PATCH /:id` | admin only | at least one field; name changes regenerate the slug; the sale price is recomputed |
| `DELETE /:id` | admin only | 409 if a brand or category is still used by products |

`GET /api/product` accepts `q` (name search, literal text, max 80), `categoryId`, `brandId`, `minPrice` / `maxPrice` (cents, applied to the sale price), `inStock=true|false`, `sort=newest|price-asc|price-desc|name`, `page`, `limit` (1–50). Unknown query parameters are rejected with 400. The response is `{ items, page, limit, total, totalPages }`. Money is always integer cents in `USD`; `salePriceCents` is computed on the server and cannot be sent by a client. Images must be `https://` URLs or `/catalogue/<name>.svg|png|jpg|webp|avif` paths.

**Known limits:** name search is an escaped, case-insensitive pattern match with no text index, so it scans the collection (fine for a demo catalogue, not for very large ones). The filter logic exists twice (MongoDB and the in-memory test double); only the skipped real-database tests would catch drift between them. Stock is reserved (decremented) when an order is placed and restored on cancel, expiry or refund; see Orders below.

## Coupons and cart (`/api/coupon`, `/api/cart`)

**Coupons** (`/api/coupon`, admin only, reads included): `POST /`, `GET /`, `GET /:id`, `PATCH /:id` (discount percent or expiry; the code is immutable), `DELETE /:id`. Codes are normalised to upper case (3–32 letters, digits, `-`, `_`); `discountPercent` is 1–90; `expiresAt` is an ISO date-time in the future (at most five years out).

**Cart** (signed-in users; the owner always comes from the token, never from a path or body):

| Route | Notes |
|---|---|
| `GET /api/cart` | Always answers with a cart (empty if none). Demo viewers may read |
| `POST /api/cart` | `{ productId, quantity }` (1–99). Adds to an existing line. 404 unknown product, 409 sold out or beyond stock |
| `PATCH /api/cart/:productId` | `{ quantity }` (0–99); 0 removes the line. 409 beyond stock |
| `DELETE /api/cart/:productId` | removes a line; 404 if it is not in the cart |
| `POST /api/cart/apply-coupon` | `{ code }`. One generic 400 for unknown or expired codes; 10 wrong guesses per user per 15 minutes, then 429 |

Only a product id and a quantity are stored. Unit prices, line totals, stock status, the coupon discount and the total are recomputed from the live catalogue and coupon on every read, so an admin price change or an expired coupon is reflected immediately. A line whose product was deleted appears as `unavailable` and is excluded from totals. Money is integer cents, the discount is rounded to whole cents, and unknown fields (a price, a total, a user id) are rejected with 400. Writes use optimistic concurrency (retry up to three times, then 409). Demo viewers get 403 on every cart write.

**Known limits:** stock is checked but not reserved or decremented (that is Step 6, orders); the coupon-guess throttle is per-process memory like the login throttle (hardening is Step 8); the browser keeps the session in `sessionStorage`, readable by any script on the page (an httpOnly refresh cookie would need a backend change). There is no account-creation screen yet: sign in with a seeded account.

## Orders and simulated payments (`/api/order`)

**No payment is ever taken.** There is no payment gateway; every order response carries `payment: { mode: "SIMULATED", notice }` and payment states are `SIMULATED_UNPAID`, `SIMULATED_PAID`, `SIMULATED_REFUNDED`. Card-like input is rejected with 400 (strict body: only `address` and `phone`, and an address containing a card-number-like digit run is refused).

| Route | Behaviour |
|---|---|
| `POST /api/order` | `{ address, phone }`. Orders the caller's own cart (prices re-read server-side, snapshotted into the order), reserves stock, empties the cart. 409 on insufficient stock or too many open orders (3), 400 on an empty cart |
| `GET /api/order` | The caller's orders, newest first (max 50) |
| `GET /api/order/:orderId` | Owner or admin; anyone else gets 404 |
| `POST /api/order/:orderId/simulate-payment` | Owner only, empty body. `PENDING_PAYMENT` → `PAID`. Repeating it is a 409, never a second payment. An overdue order becomes `EXPIRED` (409) and its stock is restored |
| `PATCH /api/order/:orderId/status` | Admin. `{ status }`: `PENDING_PAYMENT`→`CANCELLED`, `PAID`→`SHIPPED`, `SHIPPED`→`DELIVERED`. Everything else is 409 |
| `POST /api/order/:orderId/refund` | Admin. Only a `PAID`, not yet shipped order: → `CANCELLED` + `SIMULATED_REFUNDED`, stock restored |

Every transition is a compare-and-set, so concurrent requests have exactly one winner and stock is restored once. Orders expire after 30 minutes (checked on read and payment, and by a 60-second sweeper when MongoDB is configured). Demo viewers get 403 on every order write, and their orders are only `isDemo` data.

**Known limits:** stock is reserved with one conditional update per product and compensated on failure, not with a multi-document transaction (a standalone MongoDB cannot do one); a process crash between a status change and its stock restore could leak stock and there is no reconciliation job; the double-submit guard is per process; there is no admin order list yet (Step 7); the sweeper and Mongoose repositories are covered only by the skipped real-database tests.

## Admin and demo viewer (`/api/admin`)

All routes are `GET`, enforced on the server by the global guards (a hidden button is never the protection). Anonymous callers get 401 and customers get 403.

| Route | Who | Behaviour |
|---|---|---|
| `GET /api/admin/stats` | admin, demo viewer | Customer, product and order counts, low-stock (≤ 5) and sold-out products, simulated paid and refunded totals. Demo viewer: synthetic records only |
| `GET /api/admin/customers` | admin, demo viewer | Customers only (no admins), newest first, `page`/`limit`. Name and email are masked on the server (`Heba A.`, `h***@e***.com`); no hash, role or token data. Demo viewer: synthetic customers only |
| `GET /api/admin/orders` | admin, demo viewer | All orders with a masked customer, optional `status` filter. Demo viewer: synthetic orders only, so real customers' addresses are never returned to it |
| `GET /api/admin/audit` | **admin only** | Newest first. Who (id, role), what (`order.status`, `product.delete`, …), which record, and a short detail such as the requested status |

Changing an order uses the existing admin-only `PATCH /api/order/:id/status` and `POST /api/order/:id/refund`. Every successful admin write (brand, category, product, coupon, order status, refund) is audited; request bodies are never stored. Unknown query parameters are rejected with 400.

**Demo viewer:** a global guard answers 403 to any non-GET request carrying a demo-viewer token. `test/demo-readonly.spec.ts` reads every registered route from Express, requires each write route to be classified (public with a stated reason, or forbidden for the viewer) and sends the viewer's token to each forbidden one, so a new write route that is not classified fails the suite.

**Known limits:** the audit entry is written after the action succeeds, so if the audit store fails the action stays done and the failure is only logged; failed and forbidden attempts are not recorded; there is no audit retention or export; the audit log is not tamper-evident beyond having no update or delete route; customer and order lists are paginated but not searchable; there is no product or coupon management screen yet (those admin APIs exist); the new reporting queries are covered only by skipped real-database tests.

## Scripts

| Command | What it does |
|---|---|
| `npm run lint` | ESLint (strict TypeScript rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format:check` | Prettier check |
| `npm run build` | Compile to `dist/` |
| `npm test` | Unit and HTTP tests (no database needed at this stage; the real-MongoDB specs are skipped unless `MONGODB_TEST_URI` is set) |
| `npm run test:cov` | Tests with a measured coverage report in `coverage/` |

The frontend has its own scripts in `web/` (`lint`, `typecheck`, `build`, `test`, `test:cov`).

## Documentation

- [`docs/PHASE-1-PLAN.md`](docs/PHASE-1-PLAN.md) — Phase 1 execution plan, endpoint disposition, acceptance criteria, and what can and cannot be verified in each environment.

## License

MIT
