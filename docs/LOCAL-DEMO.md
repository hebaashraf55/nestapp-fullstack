# Run the demo on your Mac (MacBook Air M1)

Everything runs on your own computer, costs nothing, and no payment is ever taken. You need three free tools:
**Node.js 24** (or 22), **Docker Desktop**, and **git**.

> **Status:** these steps follow the repository's scripts and Docker Compose file. The app has been run end to end
> in a real browser against an *in-memory* API, and all automated tests pass on Node 22 and 24, but the MongoDB path
> (Docker + seed + real database) **has not been run by the author**: the build environment has no MongoDB. The 42
> MongoDB tests are written and skipped. If something fails on step 5 or 6, send me the terminal output.

## 0. One-time setup

```bash
# Node (skip if `node -v` already prints v22.x or v24.x)
brew install nvm   # or install Node 24 from https://nodejs.org
nvm install 24 && nvm use 24

# Docker Desktop (free for personal use): https://www.docker.com/products/docker-desktop/  -> open it once and wait until it says "running"
```

## 1. Get the code

From the bundle file (`nestapp-fullstack-step7.bundle`) if the GitHub push has not happened yet:

```bash
git clone nestapp-fullstack-step7.bundle nestapp-fullstack -b phase-1/step-7-admin
cd nestapp-fullstack
```

or, once the branch is on GitHub:

```bash
git clone https://github.com/hebaashraf55/nestapp-fullstack.git
cd nestapp-fullstack && git checkout phase-1/step-7-admin
```

## 2. Create your own `.env` (never commit it)

Run in the project root (`nestapp-fullstack/`):

```bash
cp .env.example .env
```

Open `.env` in any editor and set **your own** values for these lines. Use the same password in
`MONGO_ROOT_PASSWORD` and inside `MONGODB_URI` (the part between `nestapp:` and `@`):

| Variable | What to put |
|---|---|
| `MONGO_ROOT_PASSWORD` | any long random string |
| `MONGODB_URI` | same URI, with that same password |
| `JWT_SECRET` | output of `openssl rand -base64 48` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | your private admin login (password 12+ characters) |
| `SEED_DEMO_PASSWORD` | the password shared by the two demo accounts (12+ characters, different from the admin one) |

Leave `MAIL_TRANSPORT=console`, `PAYMENTS_MODE=simulated` and `CORS_ORIGINS=http://localhost:5173` as they are.

## 3. Install and start (use three Terminal windows)

**Terminal 1: project root `nestapp-fullstack/`: database, seed, API**

```bash
npm ci
npm run db:up            # starts MongoDB in Docker (127.0.0.1:27017 only); waits until healthy
npm run seed             # creates your admin + demo-customer + demo-viewer accounts
npm run seed:catalogue   # 12 synthetic products; safe to re-run
npm run build
npm run start:prod       # API on http://localhost:5000  (keep this window open)
```

Check it: open <http://localhost:5000/api/health>. You should see `"status":"ok"`.

**Terminal 2: the `web/` folder: storefront**

```bash
cd nestapp-fullstack/web
npm ci
npm run dev              # http://localhost:5173  (keep this window open)
```

Terminal 3 is only for your own commands (for example `npm run db:down` when you finish).

## 4. Open and sign in

Open <http://localhost:5173>.

| Account | Email | Password | What it shows |
|---|---|---|---|
| Demo customer | `demo-customer@example.com` | your `SEED_DEMO_PASSWORD` | shop, cart, coupons, checkout, simulated payment, your orders |
| Demo viewer | `demo-viewer@example.com` | your `SEED_DEMO_PASSWORD` | read-only: `/admin` with synthetic data only, no buttons that change anything |
| Admin (yours) | your `SEED_ADMIN_EMAIL` | your `SEED_ADMIN_PASSWORD` | `/admin`: dashboard, order actions (ship, deliver, simulated refund), masked customers, audit log |

Suggested tour: sign in as the demo customer, add two products, place the order at **Checkout** (address and phone only; there is
no card field), press **Simulate payment**. Then sign out, sign in as admin, open **Admin → Orders** and mark it shipped, and
look at **Admin → Audit log**. Finally sign in as the demo viewer and confirm you can look but not change.

No coupons are seeded, and there is no coupon screen yet (the admin coupon API exists), so the coupon box will answer "Invalid or expired coupon" until one is created.

## 5. Stop and clean up

`Ctrl+C` in Terminals 1 and 2, then `npm run db:down` (data stays in a Docker volume). To erase the demo data completely:
`docker compose down -v`.

## Troubleshooting

- **`MONGO_ROOT_PASSWORD` error from Docker:** `.env` is missing or the variable is empty.
- **API exits with a configuration error:** it names the variable; fix it in `.env`. `JWT_SECRET` must be 32+ characters.
- **Port 5000 already in use:** macOS AirPlay Receiver can take it. Set `PORT=5001` in `.env`, restart the API, and
  change `web/vite.config.ts` proxy target to `http://localhost:5001`.
- **Sign-in says invalid credentials:** you changed the seed password after seeding. The seed never overwrites an existing
  password; run `docker compose down -v`, then repeat from `npm run db:up`.
- **Emails:** verification codes for new sign-ups are printed in Terminal 1 (`MAIL_TRANSPORT=console`); the seeded accounts need none.
