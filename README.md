# ArchOS demo

Working demo of `docs/superpowers/specs/2026-10-15-archos-demo-design.md`. An AI agent rescues a failed marketplace booking and moves real Stripe test-mode money within policy. A second scene recovers an agent that cancelled 30 bookings instead of 3. All data is fictional.

## Setup

1. Node 22 and npm. `npm install`.
2. Create `.env.local` yourself (never committed) with the variables below.
3. `npm run stripe:setup` once, then put the printed `STRIPE_ACCT_CLEARHOME` in `.env.local`.
4. `npm run stripe:spike` once to prove charge, refund and transfer work in your sandbox.
5. `npm run db:setup` creates indexes in `archos`, `archos_preview` and `archos_test`.

With `STRIPE_SECRET_KEY` unset, or set to anything other than a test key, the app refuses to start (boot guard).

| Variable                  | Purpose                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `MONGODB_URI`             | Atlas connection string. Atlas is required: transactions need a replica set |
| `MONGODB_DB`              | Stage database, default `archos`                                            |
| `MONGODB_TEST_DB`         | Test database, default `archos_test`                                        |
| `STRIPE_SECRET_KEY`       | Sandbox key, `sk_test_` or `rk_test_` only. The app refuses anything else   |
| `STRIPE_SETUP_SECRET_KEY` | Full `sk_test_` key, used only by `npm run stripe:setup`                    |
| `STRIPE_ACCT_CLEARHOME`   | Connected account for the replacement provider                              |
| `STRIPE_VERIFY_TRIES`     | Stripe verification polls per operation, default 5                          |
| `NEBIUS_API_KEY`          | Enables live constraint extraction                                          |
| `NEBIUS_MODEL`            | Default `zai-org/GLM-5.3`                                                   |
| `LIVE_EXTRACTION`         | `off` forces the scripted constraints                                       |
| `DEMO_KEY`                | Optional presenter key required on every POST                               |
| `HOLD_MINUTES`            | Provider hold and consent lifetime, default 30                              |
| `SUBSIDY_CAP_PENCE`       | Per-case subsidy cap, default 2000                                          |
| `STEP_PACE_MS`            | Delay between Scene 2 recovery items, default 60                            |
| `LIVE_RUNS_PER_HOUR`      | Live model budget guard, default 20                                         |

Stripe: the `stripe` SDK (23.0.0) pins API version `2026-09-30.endive`. Charges use `allowed_payment_method_types: ["card"]`.

## Commands

| Command                                                 | What it does                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `npm run dev`                                           | App at http://localhost:3000                                      |
| `npm run build` · `npm start`                           | Production build and server                                       |
| `npm test`                                              | Unit tests, no database or network                                |
| `npm run test:acceptance`                               | End-to-end tests against `MONGODB_TEST_DB` and the Stripe sandbox |
| `npm run typecheck` · `npm run lint` · `npm run format` | Checks                                                            |

## Deploying

Vercel, region `lhr1` (`vercel.json`), Atlas in AWS `eu-west-2`. Production uses `MONGODB_DB=archos`, previews use `archos_preview`. Check `/api/health` after every deploy.

## Limits

Fictional data only. Stripe sandbox only. No authentication beyond the optional presenter key. One shared demo state per database. Fulfilment is simulated and labelled. The journal is a preview and is not posted to Briefcase. Gross commission is not profit.
