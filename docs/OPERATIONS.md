# Operations

How NOMA behaves in production and how to watch it. Everything here works on free plans; Redis is
optional.

## API versions

`/api/v1/…` is the current version and `/api/…` is its alias, so existing clients keep working. Every
response carries `API-Version: 1`. A future breaking change would ship as `/api/v2/…` beside v1.

## Health checks

| Path | Meaning | Use it for |
|---|---|---|
| `GET /api/health/live` | The process answers | Restart policy (liveness) |
| `GET /api/health/ready` | MongoDB answers a ping, and Redis when configured. 200 `ready`, otherwise **503** `not-ready` | Load balancer / Render health check |
| `GET /api/health` | Kept for older monitors: process up, payments mode | — |

They report `up`/`down` only: never hosts, versions or error text. Render uses `/api/health/ready`.

## Logs

- One line per request: method, path **without the query string**, status, duration. Health checks are
  not logged.
- Every line carries the request id. Each response returns it as `X-Request-Id`; a well-formed incoming
  `X-Request-Id` (8–64 letters, digits, `.`, `_`, `-`) is kept, so a proxy's id flows through. Jobs keep
  the id of the request that queued them.
- Production prints JSON (one object per line); development prints readable text. Override with
  `LOG_FORMAT=json|text`.
- **Redaction** runs on every message: connection-string passwords, bearer tokens, JWTs, tracking codes
  and any field named like a password, token, secret, code, cookie or card are replaced before writing.
  5xx responses never include the cause; it is logged server-side with the request id instead.

To follow one customer's problem: ask for the `X-Request-Id` (or find the request in the access log),
then search the logs for it.

## Cache

`REDIS_URL` (optional) makes the homepage feed cache shared across instances. Without it, or while Redis
is unreachable, each process uses an in-memory cache (bounded, with expiry) and keeps serving; the switch
is logged. Every catalogue write and every stock change from orders clears the cached feed; entries also
expire after 60 seconds. Prices are never taken from the cache at checkout: the cart and orders always
read products fresh.

## Background jobs

Jobs (today: outgoing email such as the guest order confirmation) are stored in the `jobs` collection
and run by a worker that polls every 2 seconds. Claiming is atomic, so several instances can run
workers safely; set `JOBS_WORKER=off` on instances that should only serve requests.

Failed attempts are retried after 10 s, 20 s, 40 s… (capped at 1 hour), up to 5 attempts; then the job is
**dead** and appears in Admin → Jobs with its (redacted) last error, where it can be retried. A job's
payload is deleted as soon as it succeeds, and the admin screen never shows payloads. Finished jobs are
removed after 14 days.

## Real-time

Socket.io at `/api/socket` (same CORS allow-list as the API). A connection is anonymous unless it sends
a valid access token; tokens are checked exactly like HTTP requests (signature, expiry, revocation).

| Event | Who receives it |
|---|---|
| `notification`, `order.updated` | Only that customer (room `user:<id>`) |
| `order.placed` | Admins (room `staff`) |
| `product.stock` | Anyone watching that product (`product.watch`), public stock only |

Clients cannot join rooms themselves except public product rooms (20 per connection). Real-time is an
extra: pages load from the API and the notification bell keeps polling every minute as a fallback.

With several API instances, live events reach only the clients connected to the instance that sent
them; a Socket.io Redis adapter would be the next step. The single free Render instance is not affected.

## Search

Products have one weighted MongoDB text index (name 10, material 4, colour 4, description 1). A search
sorts by **Best match** by default; if no whole word matches (a half-typed word, a category or brand
name), the literal case-insensitive search takes over, so results never get worse than before. User
input is never interpreted as a regular expression or a MongoDB operator.

`GET /api/product/suggest?q=` returns up to 6 products and 3 categories as you type;
`GET /api/product/facets` returns the counts shown next to the shop's filters.

## Backups

See [BACKUP.md](BACKUP.md). Atlas M0 (free) has no automatic backups.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and phase branches and on pull requests: API
lint, types, formatting, build, unit and HTTP tests, the real-MongoDB suites against a MongoDB 8 service
container, a production dependency audit, and the storefront's lint, types, tests and build.
