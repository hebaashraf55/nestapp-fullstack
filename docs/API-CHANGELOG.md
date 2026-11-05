# API change log (versus the original `nestapp`)

Phase-1 acceptance criterion 8. The original API had 33 HTTP routes, one static route and one WebSocket event (35 items). The per-endpoint evidence is in [`test-matrix.md`](test-matrix.md); the machine-readable description of the current API is [`openapi.json`](openapi.json) (also served at `GET /api/openapi.json` outside production).

## Compatibility summary

| Kind of change | Count | Notes |
|---|---|---|
| Ported with the same method and path | 26 | Body and response shapes are tightened, see "Behaviour changes" |
| Renamed | 1 | `PATCH /api/auth/confirm-email` → `POST /api/auth/verify-email` |
| Replaced | 2 | The two Stripe routes became simulated-payment routes |
| Dropped | 6 | Two uploads, `GET /api/product/test`, `GET /cats`, `GET /uploads/*`, the WebSocket gateway |
| New | 18 | Listed below |

Original 35 = 26 + 1 + 2 + 6. Current API = 26 + 1 + 2 + 18 = 47 operations.

(Counts follow the 35-row table in `test-matrix.md`.) A client written against the original API **will break** on the renamed, replaced and dropped routes, and on any request the stricter validation now rejects. This is intentional.

## Removed

| Original | Why |
|---|---|
| `POST /api/auth/upload-file`, `upload-files`, `GET /uploads/*` | Anonymous writes to local disk with no validation; not needed by the storefront |
| `GET /api/product/test` | Redis demo; Redis is not used. The path now falls into `GET /api/product/{id}` and returns 400 (not a valid id) |
| `GET /cats` | Starter-template leftover |
| WebSocket `public` / `sayHi` | Demo only |

## Renamed or replaced

| Original | Now | Why |
|---|---|---|
| `PATCH /api/auth/confirm-email` | `POST /api/auth/verify-email` | It submits a one-time code and consumes it; not an idempotent partial update |
| `POST /api/order/checkout/:orderId` (Stripe) | `POST /api/order/{orderId}/simulate-payment` | No real payments, no card data, no payment gateway. Responses carry a simulation notice |
| `POST /api/order/refund/:orderId` (Stripe) | `POST /api/order/{orderId}/refund` (admin only) | Simulated refund |

## New endpoints

`GET /api/health`, `GET /api/openapi.json` (disabled in production unless `OPENAPI_ENABLED=true`), `POST /api/auth/refresh`, `logout`, `logout-all`, `forgot-password`, `reset-password`, `GET /api/product`, `GET|PATCH|DELETE /api/product/{id}`, `GET /api/order`, `GET /api/order/{orderId}`, `PATCH /api/order/{orderId}/status`, `GET /api/admin/stats|customers|orders|audit`, `PATCH /api/product/{id}/stock` (Phase 1 finalisation), `GET /api/auth/google/nonce`, `POST /api/auth/google` (Google sign-in).

## Behaviour changes that affect clients

- **Envelope.** Every response is `{ success, data, timestamp }` or `{ success: false, error: { statusCode, error, message, details? }, timestamp }`. 5xx errors are always generic.
- **Strict bodies.** Unknown fields are rejected with 400 (including `role` on signup; public signup can never create an admin).
- **Money** is integer cents (`priceCents`); the server computes sale prices and order totals, never the client.
- **Authentication is deny-by-default.** Routes are protected unless explicitly public; roles are enforced on the server (`CUSTOMER`, `ADMIN`, read-only `DEMO_VIEWER`).
- **Ids** in paths must be valid ObjectIds (400 otherwise); list endpoints are paginated with bounded `limit`.
- **Orders** follow a state machine with atomic stock reservation, 30-minute expiry of unpaid orders and at most 3 pending orders per customer.
- **Google sign-in:** `GET /api/auth/google/nonce` returns `{ nonce, nonceToken }`; `POST /api/auth/google` takes `{ credential, nonceToken }` and answers like `login`. The ID token is verified on the server (signature, issuer, audience, expiry, verified email, single-use nonce). It only ever creates or signs in `CUSTOMER` accounts; staff and demo emails get `403`, an email linked to another Google account `409`, and with `GOOGLE_CLIENT_ID` unset both routes answer `503`. Details: [`AUTHENTICATION.md`](AUTHENTICATION.md).
- **Phase 1 finalisation (admin management):**
  - `PATCH /api/product/{id}/stock` takes `{ change: ±n }` (non-zero integer) and applies it atomically with the same operations as order reservations; stock can never go below zero (`409`).
  - `DELETE /api/product/{id}` is refused (`409`) while an unpaid or paid order still holds the product's stock; placed orders keep their own copy of each line, so deleting a product later never changes history.
  - Coupons gain an `active` flag (default `true`; documents created earlier read as active). `PATCH /api/coupon/{id}` accepts `active`. A paused or expired coupon is refused by `apply-coupon` with the same generic `Invalid or expired coupon`, and a cart holding it stops being discounted on its next read.
  - Coupon responses add `discountType` (always `PERCENT`; no other type exists), `active`, `status` (`ACTIVE` / `INACTIVE` / `EXPIRED`) and `ordersPlaced` (orders placed with the code). There is no usage limit.
  - The OpenAPI title is now `NOMA API`. All of these routes stay ADMIN-only; customers and the demo viewer get `403`, and every successful change is audited (`product.stock` is new).
- **New in Step 8:** a global request throttle (default 300 requests per 60 s per client address, `429` with `Retry-After`; `/api/health` exempt) and an explicit `trust proxy` hop count. Both are configured by environment variables (`THROTTLE_LIMIT`, `THROTTLE_WINDOW_SECONDS`, `TRUST_PROXY`).

## Not yet verified

The audit document referred to by acceptance criterion 7 ("each STATIC finding is reproduced by a test or marked not applicable") is not in the repository, so that criterion cannot be checked. See the Step 8 report.
