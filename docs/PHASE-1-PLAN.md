# Phase 1 execution plan — secure backend, data integrity, endpoint tests

Scope of Phase 1: the API only. The React storefront, animations and design system are **Phase 2** and the live demo is **Phase 3**; neither starts until Phase 1 is reviewed and approved in writing.

Ground rules (all phases)
- Zero additional cost. No payment gateway, no card data, no paid or card-gated service.
- `hebaashraf55/nestapp` is a read-only reference. All work happens in this repository, with fresh history.
- Every push is a separate approval: target repository, branch and exact changes are shown first.
- Evidence labels: **EXECUTED** (run and observed), **WRITTEN, NOT EXECUTED** (code exists, could not run in that environment), **PLANNED**, **BLOCKED**, **UNVERIFIED**.

> **Update (2026-10-25):** Step 1 was approved at commit `fc69e05`. Frontend work (Phase 2) was then authorised to start on branch `phase-2/frontend-foundation` before backend Steps 2–8 exist. The frontend only calls endpoints that are implemented; catalogue, auth, cart and orders pages wait for their backend steps.

> **Update (Step 4):** the catalogue (brands, categories, products, public reads with demo-viewer scoping, admin-only writes, `seed:catalogue`) and its storefront pages are implemented on branch `phase-1/step-4-catalogue`. Cart, coupons and checkout remain Step 5 onward.

> **Update (Step 5):** admin coupons and the server-priced cart are implemented on branch `phase-1/step-5-cart`, with a minimal sign-in page, an add-to-cart control and a cart page in the storefront. Orders and simulated payment remain Step 6.

> **Update (Step 6):** orders, the state machine, stock reservation/restore, expiry, `simulate-payment`, owner history, admin status changes and simulated refunds are implemented on branch `phase-1/step-6-orders`, with `/checkout`, `/orders` and `/orders/:id` in the storefront. The 36 real-MongoDB tests (30 before this step, 6 new) are still skipped and unverified. Admin and demo-viewer reporting was Step 7.

> **Update (Step 7):** masked customer list, dashboard stats, admin order list, audit log and the table-driven demo-viewer write-route test are implemented on branch `phase-1/step-7-admin`, with `/admin` pages in the storefront. The 42 real-MongoDB tests (36 before this step, 6 new) are still skipped and unverified. Hardening and reporting remain Step 8.

## 1. Delivery steps (each is a separate, reviewable patch series)

| Step | Contents | Needs a database to verify? |
|---|---|---|
| **1 — Foundation** *(this delivery)* | Strict TypeScript NestJS project, lint/format/typecheck/test tooling, validated config, Helmet, CORS allow-list, response and error envelopes, safe JSON-body handling, health check, guardrail tests (no payment gateway, no committed secrets) | No |
| 2 — Persistence, users, roles | Mongoose connection, `User` with `role` (`CUSTOMER`, `ADMIN`, `DEMO_VIEWER`), `isDemo` flag, `AuthGuard` (always 401, never 500), `RolesGuard`, seed scripts (admin from environment variables, demo accounts), `docker-compose.yml` for a local MongoDB | Partly |
| 3 — Authentication flows | Signup (rejects `role`), email OTP (hashed, expiring, attempt-limited, single use), login (`Credentials` shape kept), refresh, logout, forgot/reset password; mail sender abstraction (console transport by default, SMTP optional) | Partly |
| 4 — Catalog | Brands, categories, products: admin CRUD, public list/detail/search/filter/sort/pagination, ObjectId validation pipe, image references as validated URLs/asset paths (no local-disk uploads) | Partly |
| 5 — Coupons and cart | Admin coupon CRUD, cart with server-side pricing, stock checks, coupon recalculation | Yes |
| 6 — Orders and simulated payments | Order state machine, atomic stock reservation/restore, expiry, `simulate-payment`, owner order history, admin status changes and simulated refunds | Yes |
| 7 — Admin and demo-viewer | Masked customer list, dashboard stats, audit log, `DEMO_VIEWER` read-only scope (`isDemo` records only), table-driven "every write route returns 403 for demo-viewer" test | Yes |
| 8 — Hardening and reporting | Throttling, `trust proxy`, OpenAPI docs, generated test matrix, coverage report, CI workflow **draft for your review** (not committed without your approval) | Yes |

Each step ends with: changed-file list, test output, bundle + patch, and the exact apply/verify/push commands.

## 2. Disposition of every endpoint in the original `nestapp`

The old API had 33 HTTP routes, one static route and one WebSocket event. None is silently lost:

| # | Original route | Fate in this repository |
|---|---|---|
| 1–5 | `POST /api/auth/signup`, `resend-otp`, `PATCH confirm-email`, `POST login`, `GET profile` | **Ported and fixed** (step 3). `login` keeps `Credentials.{accessToken,refreshToken}`; responses never include the password hash |
| 6–7 | `POST /api/auth/upload-file(s)` | **Dropped.** Anonymous disk uploads were unsafe; they did nothing useful |
| 8–12 | Brand create/list/get/update/delete | **Ported**; delete was a stub and becomes real (step 4) |
| 13–17 | Category create/list/get/update/delete | **Ported**; update/delete were stubs (step 4) |
| 18 | `POST /api/product/create` | **Ported**, admin only, server computes `salePrice` (step 4) |
| 19 | `GET /api/product/test` (Redis demo) | **Dropped.** Redis is not used |
| 20–24 | Coupon create/list/get/update/delete | **Ported**; four were stubs (step 5) |
| 25–29 | Cart add/get/update/remove/apply-coupon | **Ported and fixed** (step 5) |
| 30 | `POST /api/order` | **Ported and fixed** (step 6) |
| 31 | `POST /api/order/checkout/:orderId` (Stripe) | **Replaced** by `POST /api/order/:orderId/simulate-payment` (step 6) |
| 32 | `POST /api/order/refund/:orderId` (Stripe) | **Replaced** by admin-only simulated refund (step 6) |
| 33 | `GET /cats` | **Dropped** (starter-template leftover) |
| 34 | `GET /uploads/*` | **Dropped** with the uploads |
| 35 | WebSocket `public` / `sayHi` | **Dropped** (demo only) |

New endpoints (product search/detail, order history, refresh/logout/password reset, admin customers/stats, health) are listed in the test matrix as they land.

**Open decision D1 (answer at step 4):** the old API used paths such as `POST /api/brand/create`. Default: keep the original paths for ported routes so the contract is recognisable, and use plain REST paths for new routes.

## 3. How verification works in each environment

| Environment | Can run | Cannot run |
|---|---|---|
| Claude's sandbox | install, lint, typecheck, format check, build, unit tests with mocked models, HTTP tests of the real app setup, state-machine and guard tests, seed-script safety tests, server smoke test | Anything needing MongoDB: the sandbox has no database, no Docker daemon, and blocks the MongoDB binary download |
| Your computer (Docker or local MongoDB) | everything, via `docker compose up -d mongo` then `npm run test:api` (added in step 2) | — |
| GitHub Actions (only if you approve the reviewed workflow file) | everything, using a Mongo service container | — |

Consequence: database-backed API tests will be **written and reported as "WRITTEN, NOT EXECUTED"** until you run them locally and send the output, or approve CI. The Phase 1 report will list those separately from tests that actually ran.

## 4. Acceptance criteria for Phase 1

1. `npm ci && npm run lint && npm run typecheck && npm run format:check && npm run build` exit 0 (logs attached).
2. `npm test` passes in the sandbox; database-backed suites are executed by you or CI, or are listed as not executed with the reason.
3. A generated `docs/test-matrix.md` has a row for every original endpoint (35) and every new endpoint, with applicable cases only, and each cell labelled EXECUTED / WRITTEN, NOT EXECUTED / PLANNED / BLOCKED.
4. Measured coverage is reported as produced. Target: at least 85% statements and 75% branches on services, guards and pipes; any gap is stated, not hidden.
5. Security: signup with `role` returns 400; no response contains a password hash; `demo-viewer` gets 403 on every write route (the test fails if a new write route is not covered); admin credentials come only from environment variables; no secret in the diff or history.
6. Payments: no payment-gateway dependency or reference; card-like fields are rejected with 400; every order payment state contains `SIMULATED` and the response says no payment was taken; illegal state transitions, repeated `simulate-payment` calls, expiry and stock restore are tested.
7. Each STATIC finding from the audit of the original code is either reproduced by a test against the new code or noted as not applicable.
8. A written API change log (what changed versus the original contract and why).

## 5. Known limits

- Runtime: Node.js 24 (Active LTS, primary) and 22 (Maintenance LTS) are tested. Node 20 is end-of-life (30 April 2026) and unsupported. Node 26 is not tested and is not claimed.

- Without a database in the sandbox, the most important integration tests need your machine or CI to execute.
- No hosting, deployment or external account is involved in Phase 1.
