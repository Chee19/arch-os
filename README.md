# ArchOS

**A booking fails. ArchOS finds a way to save it, and handles the money correctly.**

ArchOS is an autonomous recovery agent for service marketplaces. When a paid booking breaks, a refund gives the customer their money back but they still need the service, and the marketplace loses the sale. ArchOS finds a replacement provider, negotiates inside fixed policy limits, gets the customer's consent, and moves real Stripe test-mode money: a partial refund to the customer and a transfer to the new provider. Every result is checked against Stripe before it counts.

The same engine also recovers from AI agent mistakes. In Scene 2, an ops agent cancels 30 bookings when it was approved to cancel 3. ArchOS contains the agent, restores what it can, rebooks what it can't, and hands the last case to a named person.

> All companies, people and bookings are fictional. Stripe runs in test mode only.

## Contents

- [The two scenes](#the-two-scenes)
- [Features](#features)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Running the demo](#running-the-demo)
- [Commands and tests](#commands-and-tests)
- [Deploying](#deploying)
- [Project layout](#project-layout)
- [Limits](#limits)

## The two scenes

### Scene 1: "The provider cancelled. Save the booking."

Maya paid **£300** for a man and van to move her 2-bed flat on Friday. On the morning of the move, QuickMove's van breaks down.

| Step       | What happens                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Charge     | A real Stripe test PaymentIntent for £300                                                                                |
| Failure    | QuickMove cancels. £300 of booking value is at risk                                                                      |
| Understand | A live LLM turns the provider and customer messages into constraints: done by Fri 15:00, two movers, Luton van, max £300 |
| Search     | Four marketplace providers are checked in code. Two fail the constraints                                                 |
| Boundary   | BrightNest wants £340. That needs a £40 subsidy against a £20 cap, so policy blocks it                                   |
| Negotiate  | ClearHome quotes £290, accepts £280, and holds the slot for 30 minutes                                                   |
| Propose    | Maya sees the offer: £280 price, £20 back, £224 to the provider, £56 gross commission, £0 subsidy                        |
| Consent    | Nothing moves until Maya accepts. Consent expires with the hold                                                          |
| Secure     | Hold, consent, slot and money are rechecked. The booking is reassigned and the £20 refund is sent and verified           |
| Fulfil     | The move is recorded as done. This step is **simulated** and labelled so                                                 |
| Settle     | Only now is ClearHome paid £224, as a Stripe transfer tied to Maya's original charge                                     |
| Ledger     | A balanced journal preview built only from verified Stripe operations                                                    |

### Scene 2: "30 cancelled instead of 3"

An ops agent is approved to cancel 3 Harbour Lettings bookings (task OPS-311). It cancels all 30.

| Outcome                        | Count | Meaning                                                 |
| ------------------------------ | ----: | ------------------------------------------------------- |
| Approved cancellations         |     3 | Left cancelled, outside the incident                    |
| Unauthorised cancellations     |    27 | £8,100 of booking value at risk                         |
| Restored to the original slot  |    24 | Slot was still free                                     |
| Rebooked with another provider |     2 | Slot was taken; replaced within the £60 incident budget |
| Exception with a named owner   |     1 | BK-2026, owned by Priya Shah, with a due time           |

Along the way ArchOS suspends the agent's write tools (reads stay on), blocks its next call to email all 30 tenants, and waits for a person to approve the exact recovery plan before restoring anything.

## Features

- **Real money, test mode.** Charge, partial refund and Connect transfer are real Stripe sandbox calls. IDs in the Money tab link straight to the Stripe dashboard.
- **Money can't move twice.** Each operation is written to MongoDB as an intent first, sent with its op ID as the Stripe idempotency key, then read back from Stripe. Press **Replay** and Stripe returns the same transfer ID.
- **Policy is code, not model judgement.** The model only extracts constraints. Eligibility, the subsidy cap, hold expiry, consent and funding checks are deterministic, and every tool call goes through a gateway that can deny it.
- **Recheck before commit.** Securing and settling re-verify the hold, consent, slot version and remaining funds on the charge. Stale consent or an expired hold is rejected.
- **Honest states.** A booking climbs a ladder of Offered, Secured, Fulfilled and Settled. Simulated steps are badged. "Pending" and "Reconciling" are shown as such, never rounded up to success.
- **Graceful fallback.** With no model key, or if the model times out or returns implausible values, extraction falls back to scripted constraints and the UI says so.
- **Containment for rogue agents.** Scope is checked against the approved task stored apart from the agent. Out-of-scope agents lose write access.
- **Fair, budgeted allocation.** Scarce replacement slots go to the earliest service time first, within the incident budget. Commission is not an input.
- **Owned exceptions.** Anything ArchOS can't fix gets an owner, a next step and a deadline on `/exceptions`. ArchOS never closes these on its own.
- **Full audit trail.** `/history` lists every tool call, decision and denial, plus a case or verification report.

### Screens

| Route         | What it shows                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `/`           | System health (MongoDB, Stripe, Nebius) and a card to start each scene                                |
| `/case`       | Scene 1: step walkthrough, status ladder, and tabs for Reasoning, Candidates, Messages, Money, Ledger |
| `/incident`   | Scene 2: affected bookings, containment, scope, incident budget and the approval dialog               |
| `/exceptions` | Open exceptions with owner, due time and Retry                                                        |
| `/history`    | Audit trail and the final report                                                                      |

The header has a scene picker and a reset button.

## How it works

```
 Browser (Next.js UI)
     |   POST /api/demo {action}        GET /api/state
     v
 Engine: one step per "Next" click
     |
     +-- Agent ......... Nebius LLM extracts constraints (scripted fallback)
     |
     +-- Gateway ....... every tool call: scope check, policy check, audit row
     |
     +-- Money outbox .. intent row in MongoDB
     |                   -> Stripe call with op ID as idempotency key
     |                   -> read back and verify from Stripe
     |
     +-- Journal ....... built only from verified Stripe operations

 MongoDB: bookings, cases, payment ops, audit, exceptions (multi-document transactions)
```

The UI holds no business state. Each **Next** posts an action, the engine claims that step with a lock in MongoDB so a double click runs it once, and the response is the full new state.

## Quick start

### Prerequisites

| Need            | Why                                                                                  |
| --------------- | ------------------------------------------------------------------------------------ |
| Node 22 and npm | Runtime                                                                              |
| MongoDB         | A replica set, because the engine uses transactions. A free Atlas cluster works      |
| Stripe account  | Test mode with Connect enabled, so the setup script can create the ClearHome account |
| Nebius key      | Optional. Enables live constraint extraction through Nebius Token Factory            |

### 1. Install

```bash
npm install
```

### 2. Create `.env.local`

This file is gitignored. Start with the required values:

```bash
MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>/"
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_SETUP_SECRET_KEY="sk_test_..."
# Filled in by step 3
STRIPE_ACCT_CLEARHOME=""
# Optional
NEBIUS_API_KEY=""
```

The app refuses to boot unless `STRIPE_SECRET_KEY` starts with `sk_test_` or `rk_test_`.

### 3. Set up Stripe and the database

```bash
npm run stripe:setup   # creates the fictional ClearHome connected account
npm run stripe:spike   # proves charge, refund and transfer work in your sandbox
npm run db:setup       # creates indexes in archos, archos_test and archos_preview
```

`stripe:setup` prints `STRIPE_ACCT_CLEARHOME=acct_...`. Paste it into `.env.local` before running the spike. If Stripe doesn't activate transfers on the account automatically, the script creates an Express account instead and prints an onboarding link to finish by hand. `npm run stripe:setup link <acct_id>` prints a fresh link for an existing account.

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000. The Overview's health row should show MongoDB and Stripe as ok. Raw details are at http://localhost:3000/api/health.

### Environment variables

| Variable                  | Default           | Purpose                                                            |
| ------------------------- | ----------------- | ------------------------------------------------------------------ |
| `MONGODB_URI`             | none              | MongoDB connection string. Required                                |
| `MONGODB_DB`              | `archos`          | Database the app uses                                              |
| `MONGODB_TEST_DB`         | `archos_test`     | Database the acceptance tests reset. Must differ from `MONGODB_DB` |
| `STRIPE_SECRET_KEY`       | none              | `sk_test_` or `rk_test_` key. Required. Live keys are rejected     |
| `STRIPE_SETUP_SECRET_KEY` | none              | Full `sk_test_` key, used only by `npm run stripe:setup`           |
| `STRIPE_ACCT_CLEARHOME`   | none              | Connected account that receives the £224 transfer                  |
| `STRIPE_VERIFY_TRIES`     | `5`               | Stripe read-back polls per money operation                         |
| `NEBIUS_API_KEY`          | none              | Enables live constraint extraction                                 |
| `NEBIUS_MODEL`            | `zai-org/GLM-5.3` | Model used for extraction                                          |
| `LIVE_EXTRACTION`         | on                | Set to `off` to force the scripted constraints                     |
| `DEMO_KEY`                | none              | Presenter key. When set, every POST needs it                       |
| `HOLD_MINUTES`            | `30`              | Provider hold and consent lifetime                                 |
| `SUBSIDY_CAP_PENCE`       | `2000`            | Per-case subsidy cap (£20)                                         |
| `STEP_PACE_MS`            | `60`              | Delay between Scene 2 recovery items, for the animation            |

With `DEMO_KEY` set, the browser asks for the key on the first action and remembers it in local storage.

The `stripe` SDK (23.0.0) pins API version `2026-09-30.endive`. Charges use the `pm_card_bypassPending` test card so funds are available for the transfer straight away.

## Running the demo

The full run takes about three minutes. Start from the Overview and press **Run from the start** on a scene card, then **Start walkthrough**. After that, **Next step** moves one step at a time ("Next" below).

### Scene 1 script

| Screen           | Click              | Say                                                                                                              |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Overview         | none               | "You pay for a service and the provider cancels. A refund gives the money back, but you still need the service." |
| Case · charge    | Start walkthrough  | "Maya paid £300 for a man and van. That's a real Stripe test payment."                                           |
| failure          | Next               | "Friday morning, QuickMove's van breaks down. Maya hands her keys back at 5pm."                                  |
| understand       | Next               | "The agent reads both messages and pulls out what matters. That ran live on a model."                            |
| search           | Next               | "It checks providers already on the marketplace. Two can't do the job."                                          |
| boundary         | Next               | "BrightNest needs a £40 subsidy. The cap is £20. Blocked by policy, not by the model."                           |
| negotiate        | Next               | "ClearHome quotes £290. The agent offers £280. They accept and hold the slot."                                   |
| propose, consent | Next, Next, Accept | "Maya sees exactly what changes. Nothing happens until she says yes." Accept is in the Messages tab.             |
| secure           | Next               | "ArchOS rechecks everything, then rebooks and refunds £20, verified from Stripe."                                |
| fulfil, settle   | Next, Next         | "The move is simulated, and labelled so. Only then is ClearHome paid £224."                                      |
| Money tab        | Replay             | "Retries never move money twice. Same transfer, same ID."                                                        |
| ledger           | Next               | "This is the journal finance needs, built only from verified Stripe facts."                                      |

### Scene 2 script

Pick **Scene 2** in the header, press **Next** through each step, **Approve** in the dialog, then **Next** to the end.

The approval dialog shows 24 to restore, 3 manual and 3 authorised. At the end expect metrics 27 / 24 / 2 / 1, the budget at "£40 of £60 committed", and one open exception for BK-2026 on `/exceptions`.

Close with: _"Stripe moves the money. Briefcase makes it legible. ArchOS repairs the outcome when the transaction breaks."_

### Before you present

1. Check `/api/health`: `mongo`, `stripe`, `stripeTestKey` and `clearhomeTransfers` should be `true`. `nebius` and `modelAvailable` too if you want live extraction.
2. Reset Scene 1 within 10 minutes of presenting. The provider hold lasts 30 minutes from the negotiate step.
3. Open the Stripe dashboard in test mode, so you can show the PaymentIntent, refund and transfer IDs match the Money tab.
4. Present from a production build (`npm run build && npm start`, or the deployed URL), not `npm run dev`.

### If something goes wrong

| Symptom                                           | Do this                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Stripe error toast on charge                      | Press Next again. The retry reuses the same idempotency key, so it can't double-charge |
| Money row reads "Reconciling" or "Failed"         | Press Recheck on that row. A definitive failure opens an exception with a Retry button |
| Extraction badge says "Scripted fallback"         | Expected without a model key or on timeout. Policy is unchanged                        |
| Accept is disabled and the countdown says Expired | The hold ran out. Press Decline to refund the full £300, then reset                    |
| "Database unreachable" banner                     | Check your network and Atlas, then press Retry                                         |
| 409 toast after a double click                    | Ignore it. The step ran once                                                           |

## Commands and tests

| Command                       | What it does                                                       |
| ----------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                 | Dev server at http://localhost:3000                                |
| `npm run build` · `npm start` | Production build and server                                        |
| `npm test`                    | 270+ unit tests. No database or network, runs in about 2 seconds   |
| `npm run test:acceptance`     | End-to-end tests against `MONGODB_TEST_DB` and your Stripe sandbox |
| `npm run typecheck`           | TypeScript check                                                   |
| `npm run lint`                | ESLint                                                             |
| `npm run format`              | Prettier                                                           |

Acceptance tests reset their database, so they refuse to run if `MONGODB_TEST_DB` equals `MONGODB_DB`. They force scripted extraction to stay offline from the model.

## Deploying

The app targets Vercel in region `lhr1` (see `vercel.json`), with Atlas in AWS `eu-west-2`. Set the same environment variables in Vercel. Use `MONGODB_DB=archos` for production and `archos_preview` for previews, so a preview run never touches the stage demo. Check `/api/health` after every deploy. It returns `503` if MongoDB or Stripe is unreachable.

## Project layout

```
src/
  app/          Next.js routes: pages and /api/{demo,state,health}
  engine/       Steps, gateway, policy, incident detection, recovery, exceptions, store
  money/        Stripe client, payment outbox, verification, reconciliation, split maths
  ledger/       Journal preview built from verified money
  agent/        Live constraint extraction and its sanity checks
  scenarios/    The two scenes: seed data, tools and recovery plans
  ui/           React views and components
scripts/        Stripe and database setup, Stripe spike
tests/
  unit/         Pure logic, offline
  acceptance/   Full runs against MongoDB and Stripe test mode
```

Built with Next.js 16, React 19, MongoDB, Stripe, Zod, GSAP and Vitest.

## Limits

This is a demo, not a product.

- Fictional data and the Stripe sandbox only.
- No authentication beyond the optional presenter key.
- One shared demo state per database. Reset clears it for everyone.
- Fulfilment is simulated and labelled.
- The model only extracts constraints. The full live agent loop is a stretch goal and is disabled in the UI.
- The journal is a preview and is not posted to Briefcase.
- Gross commission is not profit.
