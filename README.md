# nestapp-fullstack

A full-stack e-commerce portfolio project: a **NestJS + MongoDB API** (Phase 1) and a **React storefront** (Phase 2).

> **Status: Phase 1 in progress.** Only the API foundation exists so far (configuration, security headers, CORS allow-list, response envelope, error handling, health check). Nothing is deployed. There is no live demo yet.

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
| Database, authentication, catalog, cart, orders, admin | **Not started** — see [the Phase 1 plan](docs/PHASE-1-PLAN.md) |

## Quick start

Requires **Node.js 24 (Active LTS, recommended)** or Node.js 22 (Maintenance LTS). Node.js 20 reached end of life on 30 April 2026 and is not supported. `.nvmrc` pins 24.

```bash
npm ci
cp .env.example .env     # edit if needed; never commit .env
npm run start:dev        # http://localhost:5000/api/health
```

## Scripts

| Command | What it does |
|---|---|
| `npm run lint` | ESLint (strict TypeScript rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format:check` | Prettier check |
| `npm run build` | Compile to `dist/` |
| `npm test` | Unit and HTTP tests (no database needed at this stage) |
| `npm run test:cov` | Tests with a measured coverage report in `coverage/` |

## Documentation

- [`docs/PHASE-1-PLAN.md`](docs/PHASE-1-PLAN.md) — Phase 1 execution plan, endpoint disposition, acceptance criteria, and what can and cannot be verified in each environment.

## License

MIT
