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
| React + TypeScript + Vite shell in `web/` (animated landing, live API status, reduced-motion support) | Implemented and tested; **no catalogue or checkout yet** — those need backend endpoints that do not exist |
| MongoDB connection, `User` model with roles (`CUSTOMER`, `ADMIN`, `DEMO_VIEWER`), scrypt password hashing | Implemented. Mongoose-backed tests are written but have **not been run** (no MongoDB in the build sandbox) |
| Global deny-by-default `AuthGuard`, `RolesGuard`, read-only enforcement for the demo viewer, demo-data scope helper | Implemented and tested (in-memory user store). Tokens can't be obtained yet: login is Step 3 |
| Seed script (owner admin from env vars, synthetic demo accounts), `docker-compose.yml` | Implemented; seed logic tested in memory, real-database run pending on your machine |
| Signup/login flows, catalog, cart, orders, admin endpoints | **Not started** — see [the Phase 1 plan](docs/PHASE-1-PLAN.md) |

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
npm run test:db          # optional: runs the MongoDB-backed tests (set MONGODB_TEST_URI in .env first)
npm run db:down          # stops the database (data stays in a Docker volume)
```

Credentials come only from `.env` (git-ignored). `SEED_ADMIN_*` is your private owner account; the demo accounts hold synthetic data only. The seed never overwrites an existing password or promotes an existing account. Generate a secret with `openssl rand -base64 48`.

## Scripts

| Command | What it does |
|---|---|
| `npm run lint` | ESLint (strict TypeScript rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format:check` | Prettier check |
| `npm run build` | Compile to `dist/` |
| `npm test` | Unit and HTTP tests (no database needed at this stage) |
| `npm run test:cov` | Tests with a measured coverage report in `coverage/` |

The frontend has its own scripts in `web/` (`lint`, `typecheck`, `build`, `test`, `test:cov`).

## Documentation

- [`docs/PHASE-1-PLAN.md`](docs/PHASE-1-PLAN.md) — Phase 1 execution plan, endpoint disposition, acceptance criteria, and what can and cannot be verified in each environment.

## License

MIT
