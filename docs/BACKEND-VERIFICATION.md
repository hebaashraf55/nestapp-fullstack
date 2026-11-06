# Backend verification

How each backend feature is proven. Three kinds of automated evidence exist:

- **HTTP tests** (`test/*.spec.ts`): the real NestJS controllers, guards, validation and services over HTTP, with in-memory repositories in place of MongoDB. Fast; run on every `npm test`.
- **Repository tests on real MongoDB** (`test/db/*.mongo.spec.ts`): the Mongoose repositories against a real database (indexes, atomic updates, races, malformed input).
- **End to end on real MongoDB** (`test/db/e2e-api.mongo.spec.ts`): the production `AppModule` over HTTP against a real database, nothing mocked except outgoing email; includes an application restart. Run with `npm run test:db` (needs `MONGODB_TEST_URI`, whose database name must contain "test"; it is emptied first).

| Feature | API tested | Real DB tested | Authorization tested | Automated tests | Result |
|---|---|---|---|---|---|
| Registration (signup, emailed code, verify) | Yes | Yes (e2e) | Role cannot be chosen by the client (400) | auth-flows, e2e | Real |
| Login, logout, logout-all, refresh rotation, reset | Yes | Yes (repo + e2e, refresh survives restart) | Wrong password 401, unverified 403 | auth, auth-flows, auth.mongo, e2e | Real |
| Google sign-in (ID token, nonce, linking, customers only) | Yes | Yes (users repo + e2e) | Staff/demo emails 403, foreign link 409, strict body | google-id-token.verifier (Google's real library, local keys), auth-google, users.mongo, e2e | Real (needs `GOOGLE_CLIENT_ID`) |
| Password hashing | Yes | Yes (stored as `scrypt$…`, never plain) | — | password, e2e | Real |
| JWT validation and expiry | Yes | Yes (e2e) | Missing, forged, expired, `alg:none` → 401 | auth, e2e | Real |
| Roles (ADMIN, CUSTOMER, DEMO_VIEWER) | Yes | Yes (e2e) | Every write route classified; viewer 403 on all | guards, demo-readonly, matrix, e2e | Real |
| Profile | Yes | Yes | Own profile only | auth, e2e | Real (no profile editing endpoint) |
| Admin customers | Yes | Yes (repo) | Admin and viewer read, masked; customer 403 | admin, admin.mongo | Real, read-only list |
| Products CRUD, search, filter, sort, paging | Yes | Yes (repo + e2e) | Writes admin-only | catalogue, catalogue.mongo, admin-management, e2e | Real |
| Stock changes | Yes | Yes (atomic, never negative) | Admin-only | admin-management, orders.mongo, e2e | Real |
| Product images | Yes | — | — | catalogue-units | Real: validated https URLs or site paths; files are static assets, no upload endpoint |
| Persistence after restart | Yes | Yes (e2e restarts the app) | — | e2e | Real |
| Cart (add, update, remove, server pricing, stock) | Yes | Yes (repo + e2e) | Own cart only; client prices rejected (400) | cart, cart.mongo, e2e | Real |
| Coupons (valid, unknown, expired, paused, duplicate) | Yes | Yes (repo + e2e) | Admin-only, customer and viewer 403 | cart, admin-management, cart.mongo, e2e | Real |
| Coupon usage limits / minimum purchase | — | — | — | — | **Not implemented** (orders per code are counted, not limited) |
| Orders: totals, reservation, expiry, state machine | Yes | Yes (repo + e2e) | Owner or admin; others 404 | orders, orders.mongo, e2e | Real |
| Concurrency (oversell) | Yes | Yes: 6 buyers, 3 units → exactly 3 orders | — | orders.mongo, e2e | Real |
| Simulated payment, duplicate payment, refund | Yes | Yes (two concurrent payments → one 200, one 409) | Owner pays; admin refunds | orders, e2e | **Simulated** by design: no gateway, card data refused |
| Admin dashboard figures | Yes | Yes (derived from DB, e2e) | Admin all, viewer synthetic only, customer 403 | admin, admin.mongo, e2e | Real |
| Audit log | Yes | Yes (survives restart) | Admin-only | admin, e2e | Real |
| Homepage feed (categories with counts, featured, new, sale, best sellers) | Yes | Yes (repo filters) | Public; demo viewer sees synthetic only | shopper, catalogue.mongo | Real: best sellers come only from paid orders |
| Product specifications and featured flag | Yes | Yes (every read path) | Admin-only writes | catalogue, catalogue.mongo | Real |
| Wishlist (add, remove, merge guest list, 100 cap) | Yes | Yes (concurrent adds, no duplicates) | Own list only; sign-in required; viewer 403 | shopper, shopper.mongo | Real |
| Recently viewed (newest first, 20 cap, merge) | Yes | Yes (order, cap, operator-object id) | Own history only | shopper, shopper.mongo | Real |
| Product comparison (2–4) | Yes | Yes | Public | shopper | Real |
| Reviews and ratings (one per customer per product, sort, paging, summary) | Yes | Yes (6 racing submissions → 1 review; summary; operator input) | Customers write; author edits; author or admin deletes; others 404 | reviews, reviews.mongo | Real |
| Verified purchase | Yes | Yes (paid/shipped/delivered only) | Decided by the server; a client-sent flag is rejected (400) | reviews, orders.mongo | Real |
| Review moderation (pending → approved/rejected, note, re-moderation on edit) | Yes | Yes | Admin decides (audited); viewer reads synthetic only; customer 403 | reviews, reviews.mongo, demo-readonly | Real |
| Validation, 404, 409, error envelope | Yes | Yes | — | app, catalogue, orders, e2e | Real |
| Rate limiting | Yes | In-memory counters | — | throttle, auth | Real, per process (not shared across instances) |
| OpenAPI accuracy | Generated from the running app; a test fails if a route lacks a summary or the file drifts | — | — | openapi | Real |

**Demo data:** the seeds create the admin, two demo accounts and 56 products across 7 categories (8 each) (flagged `isDemo`). **Simulated:** payments and refunds only.
